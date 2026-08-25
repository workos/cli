import open from 'open';
import chalk from 'chalk';
import ui from '../utils/ui.js';
import { saveCredentials, getCredentials, getAccessToken, isTokenExpired, updateTokens } from '../lib/credentials.js';
import { getCliAuthClientId, getAuthkitDomain } from '../lib/settings.js';
import { refreshAccessToken } from '../lib/token-refresh-client.js';
import { logInfo, logError } from '../utils/debug.js';
import { fetchStagingCredentials, StagingApiError } from '../lib/staging-api.js';
import { analytics } from '../utils/analytics.js';
import { getConfig, saveConfig, getActiveEnvironment, setActiveEnvironment, freshEnvKey } from '../lib/config-store.js';
import type { CliConfig, EnvironmentConfig } from '../lib/config-store.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { maybeRunSetupAfter } from './setup.js';
import { isJsonMode, outputJson } from '../utils/output.js';
import { isAgentMode, isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import { ExitCode, exitWithAuthRequired, exitWithCode } from '../utils/exit-codes.js';
import { requestDeviceCode, pollForToken, DeviceAuthTimeoutError } from '../lib/device-auth.js';
import { observeHostFailure } from '../lib/host-probe.js';
import { tryResolveProfileEnvironmentId } from '../lib/environment-target.js';

/**
 * Result of a post-login staging provision. Carries enough context for
 * `runLogin` to detect a cross-account switch and decide how to surface it
 * without ever silently repointing the active environment.
 */
export interface StagingProvisionResult {
  provisioned: boolean;
  /** Active env name AFTER provisioning (unchanged unless there was no prior active env). */
  activeEnvironment?: string;
  /** Key the new Staging env was written under ('staging' or a fresh 'staging-N'). */
  envName?: string;
  mismatch: boolean;
  priorEnvName?: string;
  priorAccount?: { email?: string; clientId?: string };
}

/**
 * Does the just-authenticated account differ from the account that owns `prior`?
 *
 * Email comparison wins when both sides have it (human-readable, survives a
 * clientId reissue); otherwise fall back to clientId. When neither is available
 * we cannot tell — return false and let the always-on "Now using" line protect
 * the user.
 */
function isMismatch(
  prior: EnvironmentConfig | undefined,
  account: { email?: string },
  staging: { clientId: string },
): boolean {
  if (!prior) return false;
  if (prior.ownerEmail && account.email) return prior.ownerEmail !== account.email;
  if (prior.clientId) return prior.clientId !== staging.clientId;
  return false;
}

/**
 * Auto-provision a staging environment after login.
 *
 * Fetches staging credentials for the just-authenticated account and stores
 * them. On a detected cross-account mismatch, the new account's Staging is
 * written under a DISTINCT key rather than clobbering the active slot, and the
 * active pointer is left alone — only a login onto an empty config auto-assigns
 * the active env. Non-fatal — logs a hint on failure instead of throwing.
 */
export async function provisionStagingEnvironment(
  accessToken: string,
  account: { email?: string; userId: string },
): Promise<StagingProvisionResult> {
  try {
    const staging = await fetchStagingCredentials(accessToken);

    const config: CliConfig = getConfig() ?? { environments: {} };

    const priorName = config.activeEnvironment;
    const prior = priorName ? config.environments[priorName] : undefined; // capture BEFORE write
    const mismatch = isMismatch(prior, account, staging);

    // Never overwrite a DIFFERENT account's 'staging' slot in place.
    const stagingSlot = config.environments['staging'];
    const slotMismatch = isMismatch(stagingSlot, account, staging);
    const key = slotMismatch ? freshEnvKey(config, 'staging') : 'staging';

    config.environments[key] = {
      name: key,
      type: 'sandbox',
      apiKey: staging.apiKey,
      clientId: staging.clientId,
      ...(account.email && { ownerEmail: account.email }),
      ownerUserId: account.userId,
    };

    // Only auto-assign active when there is NO valid prior active env.
    if (!prior) {
      config.activeEnvironment = key;
    }

    saveConfig(config);
    logInfo('[login] Staging environment provisioned');

    return {
      provisioned: true,
      activeEnvironment: config.activeEnvironment,
      envName: key,
      mismatch,
      priorEnvName: priorName,
      priorAccount: prior ? { email: prior.ownerEmail, clientId: prior.clientId } : undefined,
    };
  } catch (error) {
    logError('[login] Failed to provision staging environment:', error instanceof Error ? error.message : error);
    // Best-effort, but the failure rate of this onboarding step must be visible:
    // a silent failure here leaves the user with no active environment for every
    // later command, indistinguishable in telemetry from a healthy setup.
    analytics.captureException(error instanceof Error ? error : new Error(String(error)), {
      command: 'auth.login',
      phase: 'provision-staging',
      statusCode: error instanceof StagingApiError ? error.statusCode : undefined,
    });
    return { provisioned: false, mismatch: false };
  }
}

export async function runLogin(): Promise<void> {
  const clientId = getCliAuthClientId();

  // Check if already logged in with valid token
  if (getAccessToken()) {
    const creds = getCredentials();
    console.log(chalk.green(`Already logged in as ${creds?.email ?? 'unknown'}`));
    console.log(chalk.dim(`Run \`${formatWorkOSCommand('auth logout')}\` to log out`));
    return;
  }

  // Try to refresh if we have expired credentials with a refresh token
  const existingCreds = getCredentials();
  if (existingCreds?.refreshToken && isTokenExpired(existingCreds)) {
    try {
      const authkitDomain = getAuthkitDomain();
      const result = await refreshAccessToken(authkitDomain, clientId);
      if (result.accessToken && result.expiresAt) {
        updateTokens(result.accessToken, result.expiresAt, result.refreshToken);
        logInfo('[login] Session refreshed via refresh token');
        console.log(chalk.green(`Already logged in as ${existingCreds.email ?? 'unknown'}`));
        console.log(chalk.dim(`Run \`${formatWorkOSCommand('auth logout')}\` to log out`));
        return;
      }
      // Refresh returned no token — record why before falling through to fresh
      // login. A spike here surfaces token revocation / refresh-endpoint outages
      // that self-heal into a browser login and would otherwise be invisible.
      analytics.capture('token_refresh_failed', { errorType: result.errorType ?? 'unknown' });
    } catch (error) {
      analytics.capture('token_refresh_failed', { errorType: error instanceof Error ? error.name : 'unknown' });
      // Refresh failed, proceed with fresh login.
    }
  }

  if (isCiMode()) {
    exitWithAuthRequired(
      'Browser authentication is not available in CI mode. Set WORKOS_API_KEY or configure credentials before running in CI.',
    );
  }

  const authkitDomain = getAuthkitDomain();

  ui.log.step('Starting authentication...');

  let deviceAuth;
  try {
    deviceAuth = await requestDeviceCode({ clientId, authkitDomain });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ui.log.error(`Failed to start authentication: ${msg}`);
    analytics.captureException(error instanceof Error ? error : new Error(msg), {
      command: 'auth.login',
      phase: 'device-code',
    });
    exitWithCode(ExitCode.GENERAL_ERROR);
  }

  ui.log.info(`\nOpen this URL in your browser:\n`);
  console.log(`  ${deviceAuth.verification_uri}`);
  console.log(`\nEnter code: ${deviceAuth.user_code}\n`);

  try {
    await open(deviceAuth.verification_uri_complete, { wait: false });
    if (isAgentMode()) {
      ui.log.info('Browser launch attempted. If it did not open on the host, use the manual URL and code above.');
    } else {
      ui.log.info('Browser opened automatically');
    }
  } catch (error) {
    observeHostFailure('browser-launch', error, {
      operation: 'open',
      target: deviceAuth.verification_uri_complete,
      label: 'auth login browser',
    });
    ui.log.info('Could not open browser — open the URL above manually.');
  }

  const spinner = ui.spinner();
  spinner.start('Waiting for authentication...');

  try {
    const result = await pollForToken(deviceAuth.device_code, {
      clientId,
      authkitDomain,
      interval: deviceAuth.interval,
    });

    const expiresInSec = Math.round((result.expiresAt - Date.now()) / 1000);

    saveCredentials({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      userId: result.userId,
      email: result.email,
      refreshToken: result.refreshToken,
    });

    spinner.stop('Authentication successful!');
    ui.log.success(`Logged in as ${result.email || result.userId}`);
    ui.log.info(`Token expires in ${expiresInSec} seconds`);

    const account = { email: result.email, userId: result.userId };
    const provision = await provisionStagingEnvironment(result.accessToken, account);

    // Best-effort: stamp the provisioned profile with its dashboard environment
    // ID (clientId join) so dashboard-plane commands target Staging instead of
    // hitting the server's production fallback. Non-fatal — same posture as
    // provisionStagingEnvironment; resolution defers to first use on failure.
    if (provision.provisioned && provision.envName) {
      await tryResolveProfileEnvironmentId(provision.envName, { token: result.accessToken });
    }

    if (isJsonMode()) {
      outputJson({
        status: 'ok',
        account: { email: account.email ?? null, userId: account.userId },
        activeEnvironment: provision.activeEnvironment ?? null,
        mismatch: provision.mismatch,
      });
    } else if (provision.provisioned) {
      if (provision.mismatch) {
        const priorLabel = provision.priorAccount?.email ?? provision.priorAccount?.clientId ?? provision.priorEnvName;
        if (isPromptAllowed()) {
          const answer = await ui.confirm({
            message: `You were using ${provision.priorEnvName} (${priorLabel}, a different account). Switch active environment to ${account.email ?? account.userId}'s Staging?`,
            initialValue: false, // default: keep current
          });
          if (!ui.isCancel(answer) && answer && provision.envName) {
            setActiveEnvironment(provision.envName);
          }
        } else {
          ui.log.warn(
            `Logged in as ${account.email ?? account.userId}, but the active environment "${provision.priorEnvName}" belongs to a different account (${priorLabel}). Keeping it active. Run \`${formatWorkOSCommand('env switch')}\` to change environments.`,
          );
        }
      }
      const active = getActiveEnvironment();
      if (active) {
        ui.log.success(`Now using: ${active.name} (${active.type}) — ${account.email ?? account.userId}`);
      } else {
        ui.log.info(chalk.dim(`Run \`${formatWorkOSCommand('env add')}\` to configure an environment manually`));
      }
    } else {
      ui.log.info(chalk.dim(`Run \`${formatWorkOSCommand('env add')}\` to configure an environment manually`));
    }

    await maybeRunSetupAfter('login');
  } catch (error) {
    const isTimeout = error instanceof DeviceAuthTimeoutError;
    if (isTimeout) {
      spinner.stop('Authentication timed out', 1);
      ui.log.error('Authentication timed out. Please try again.');
    } else {
      spinner.stop('Authentication failed', 1);
      const msg = error instanceof Error ? error.message : String(error);
      ui.log.error(`Authentication error: ${msg}`);
    }
    // Deliver the real cause to telemetry (the command event alone can't
    // distinguish a timeout from a network/server auth failure).
    analytics.captureException(error instanceof Error ? error : new Error(String(error)), {
      command: 'auth.login',
      phase: isTimeout ? 'timeout' : 'poll',
    });
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}
