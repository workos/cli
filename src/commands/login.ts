import open from 'open';
import chalk from 'chalk';
import clack from '../utils/clack.js';
import { saveCredentials, getCredentials, getAccessToken, isTokenExpired, updateTokens } from '../lib/credentials.js';
import { getCliAuthClientId, getAuthkitDomain } from '../lib/settings.js';
import { refreshAccessToken } from '../lib/token-refresh-client.js';
import { logInfo, logError } from '../utils/debug.js';
import { fetchStagingCredentials } from '../lib/staging-api.js';
import { getConfig, saveConfig } from '../lib/config-store.js';
import type { CliConfig } from '../lib/config-store.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { autoInstallSkills } from './install-skill.js';
import { isJsonMode } from '../utils/output.js';
import { isAgentMode, isCiMode } from '../utils/interaction-mode.js';
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
 * Auto-provision a staging environment after login.
 *
 * Fetches staging credentials using the access token, then saves them
 * as a "staging" environment in the config store. Non-fatal — logs a
 * hint on failure instead of throwing.
 */
export async function provisionStagingEnvironment(accessToken: string): Promise<boolean> {
  try {
    const staging = await fetchStagingCredentials(accessToken);

    const config: CliConfig = getConfig() ?? { environments: {} };
    const isFirst = Object.keys(config.environments).length === 0;

    config.environments['staging'] = {
      name: 'staging',
      type: 'sandbox',
      apiKey: staging.apiKey,
      clientId: staging.clientId,
    };

    if (isFirst || !config.activeEnvironment) {
      config.activeEnvironment = 'staging';
    }

    saveConfig(config);
    logInfo('[login] Staging environment auto-provisioned');
    return true;
  } catch (error) {
    logError('[login] Failed to auto-provision staging environment:', error instanceof Error ? error.message : error);
    return false;
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

    const provisioned = await provisionStagingEnvironment(result.accessToken);
    if (provisioned) {
      clack.log.success('Staging environment configured automatically');
    } else {
      clack.log.info(chalk.dim('Run `workos env add` to configure an environment manually'));
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
