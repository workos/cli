import open from 'open';
import chalk from 'chalk';
import clack from '../utils/clack.js';
import { saveCredentials, getCredentials, getAccessToken, isTokenExpired, updateTokens } from '../lib/credentials.js';
import { getCliAuthClientId, getAuthkitDomain } from '../lib/settings.js';
import { refreshAccessToken } from '../lib/token-refresh-client.js';
import { logInfo, logError } from '../utils/debug.js';
import { fetchStagingCredentials } from '../lib/staging-api.js';
import { getConfig, saveConfig, getActiveEnvironment, setActiveEnvironment } from '../lib/config-store.js';
import type { CliConfig, EnvironmentConfig } from '../lib/config-store.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { autoInstallSkills } from './install-skill.js';
import { isJsonMode, outputJson } from '../utils/output.js';
import { isAgentMode, isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import { ExitCode, exitWithAuthRequired, exitWithCode } from '../utils/exit-codes.js';
import { requestDeviceCode, pollForToken, DeviceAuthTimeoutError } from '../lib/device-auth.js';
import { observeHostFailure } from '../lib/host-probe.js';

/**
 * Best-effort skill install after a successful auth-login.
 *
 * Mirrors the install.ts hook copy, but wraps `autoInstallSkills` in its own
 * try/catch AND a 30s timeout so a skill install hang (e.g. blocked filesystem
 * call) never blocks login completion. Login already succeeded by the time
 * this runs — the user having a working session is the contract that must hold.
 *
 * Extracted from runLogin so it can be unit-tested without standing up the
 * device-auth polling loop.
 */
export const SKILL_INSTALL_TIMEOUT_MS = 30 * 1000;

export async function installSkillsAfterLogin(): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(null), SKILL_INSTALL_TIMEOUT_MS);
      // Don't keep the event loop alive on this timer — process should exit
      // immediately if everything else has resolved.
      timeoutHandle.unref?.();
    });
    const result = await Promise.race([autoInstallSkills(), timeout]);
    if (result && !isJsonMode()) {
      const skillWord = result.skills.length === 1 ? 'skill' : 'skills';
      clack.log.info(`Installed ${result.skills.length} WorkOS ${skillWord} for ${result.agents.join(', ')}.`);
    }
  } catch {
    // Skill install must never fail login.
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/**
 * Result of a post-login staging provision. Carries enough context for
 * `runLogin` to detect a cross-account switch and decide how to surface it
 * without ever silently repointing the active environment.
 */
export interface StagingProvisionResult {
  provisioned: boolean;
  account: { email?: string; userId: string };
  /** Active env name AFTER provisioning (unchanged unless there was no prior active env). */
  activeEnvironment?: string;
  /** Key the new Staging env was written under ('staging' or a fresh 'staging-N'). */
  envName?: string;
  envType?: EnvironmentConfig['type'];
  mismatch: boolean;
  /** True only when provisioning repointed the active env (the no-prior-active case). */
  switched: boolean;
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

/** Pick a non-colliding key for a new Staging env: 'staging', else 'staging-2', 'staging-3', … */
function freshStagingKey(config: CliConfig): string {
  if (!config.environments['staging']) return 'staging';
  let i = 2;
  while (config.environments[`staging-${i}`]) i++;
  return `staging-${i}`;
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
    const key = slotMismatch ? freshStagingKey(config) : 'staging';

    config.environments[key] = {
      name: key,
      type: 'sandbox',
      apiKey: staging.apiKey,
      clientId: staging.clientId,
      ...(account.email && { ownerEmail: account.email }),
      ownerUserId: account.userId,
    };

    // Only auto-assign active when there is NO valid prior active env.
    let switched = false;
    if (!prior) {
      config.activeEnvironment = key;
      switched = true;
    }

    saveConfig(config);
    logInfo('[login] Staging environment provisioned');

    return {
      provisioned: true,
      account,
      activeEnvironment: config.activeEnvironment,
      envName: key,
      envType: 'sandbox',
      mismatch,
      switched,
      priorEnvName: priorName,
      priorAccount: prior ? { email: prior.ownerEmail, clientId: prior.clientId } : undefined,
    };
  } catch (error) {
    logError('[login] Failed to provision staging environment:', error instanceof Error ? error.message : error);
    return { provisioned: false, account, mismatch: false, switched: false };
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
    } catch {
      // Refresh failed, proceed with fresh login
    }
  }

  if (isCiMode()) {
    exitWithAuthRequired(
      'Browser authentication is not available in CI mode. Set WORKOS_API_KEY or configure credentials before running in CI.',
    );
  }

  const authkitDomain = getAuthkitDomain();

  clack.log.step('Starting authentication...');

  let deviceAuth;
  try {
    deviceAuth = await requestDeviceCode({ clientId, authkitDomain });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    clack.log.error(`Failed to start authentication: ${msg}`);
    exitWithCode(ExitCode.GENERAL_ERROR);
  }

  clack.log.info(`\nOpen this URL in your browser:\n`);
  console.log(`  ${deviceAuth.verification_uri}`);
  console.log(`\nEnter code: ${deviceAuth.user_code}\n`);

  try {
    await open(deviceAuth.verification_uri_complete, { wait: false });
    if (isAgentMode()) {
      clack.log.info('Browser launch attempted. If it did not open on the host, use the manual URL and code above.');
    } else {
      clack.log.info('Browser opened automatically');
    }
  } catch (error) {
    observeHostFailure('browser-launch', error, {
      operation: 'open',
      target: deviceAuth.verification_uri_complete,
      label: 'auth login browser',
    });
    clack.log.info('Could not open browser — open the URL above manually.');
  }

  const spinner = clack.spinner();
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
    clack.log.success(`Logged in as ${result.email || result.userId}`);
    clack.log.info(`Token expires in ${expiresInSec} seconds`);

    const account = { email: result.email, userId: result.userId };
    const provision = await provisionStagingEnvironment(result.accessToken, account);

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
          const answer = await clack.confirm({
            message: `You were using ${provision.priorEnvName} (${priorLabel}, a different account). Switch active environment to ${account.email ?? account.userId}'s Staging?`,
            initialValue: false, // default: keep current
          });
          if (!clack.isCancel(answer) && answer && provision.envName) {
            setActiveEnvironment(provision.envName);
          }
        } else {
          clack.log.warn(
            `Logged in as ${account.email ?? account.userId}, but the active environment "${provision.priorEnvName}" belongs to a different account (${priorLabel}). Keeping it active. Run \`${formatWorkOSCommand('env switch')}\` to change environments.`,
          );
        }
      }
      const active = getActiveEnvironment();
      if (active) {
        clack.log.success(`Now using: ${active.name} (${active.type}) — ${account.email ?? account.userId}`);
      } else {
        clack.log.info(chalk.dim(`Run \`${formatWorkOSCommand('env add')}\` to configure an environment manually`));
      }
    } else {
      clack.log.info(chalk.dim(`Run \`${formatWorkOSCommand('env add')}\` to configure an environment manually`));
    }

    await installSkillsAfterLogin();
  } catch (error) {
    if (error instanceof DeviceAuthTimeoutError) {
      spinner.stop('Authentication timed out');
      clack.log.error('Authentication timed out. Please try again.');
    } else {
      spinner.stop('Authentication failed');
      const msg = error instanceof Error ? error.message : String(error);
      clack.log.error(`Authentication error: ${msg}`);
    }
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}
