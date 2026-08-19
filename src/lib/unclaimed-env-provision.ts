/**
 * Unclaimed environment provisioning helper.
 *
 * Calls the unclaimed env API, saves credentials to config store as type 'unclaimed',
 * and returns whether provisioning succeeded. Non-fatal — wraps everything in
 * try/catch so install flow can fall back to login.
 */

import chalk from 'chalk';
import { provisionUnclaimedEnvironment, UnclaimedEnvApiError } from './unclaimed-env-api.js';
import { getConfig, saveConfig, getActiveEnvironment, freshEnvKey } from './config-store.js';
import type { CliConfig } from './config-store.js';
import { writeCredentialsEnv } from './env-writer.js';
import { logInfo, logError } from '../utils/debug.js';
import { renderStderrNotice } from '../utils/box.js';
import ui from '../utils/ui.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

export interface UnclaimedEnvProvisionOptions {
  installDir: string;
  /** Redirect URI key name varies by framework */
  redirectUriKey?: string;
  /** Redirect URI value */
  redirectUri?: string;
}

/**
 * Try to provision an unclaimed environment. Non-fatal — returns true on success,
 * false on any failure.
 *
 * On success:
 * - Saves environment to config store as type 'unclaimed'
 * - Sets it as active environment
 * - Writes credentials (including cookie password and claim token) to .env.local
 */
export async function tryProvisionUnclaimedEnv(options: UnclaimedEnvProvisionOptions): Promise<boolean> {
  try {
    logInfo('[unclaimed-env-provision] Attempting unclaimed environment provisioning');

    // No-clobber invariant, enforced by the function that does the writing:
    // never overwrite credentials the project already has. Keyed on credentials
    // only (never on AuthKit detection) so `install --force` still works.
    // Checked before provisioning so no environment is created then abandoned.
    const { readProjectEnvCredentials, resolveProjectEnvPath } = await import('./project-env.js');
    const projectEnv = readProjectEnvCredentials(options.installDir);
    if (projectEnv.apiKey) {
      logInfo('[unclaimed-env-provision] Refusing to provision: project env already has WORKOS_API_KEY');
      // Name the file the key was actually found in, not the file we would have
      // written: the key can live in any of `ENV_FILE_NAMES`, and pointing at the
      // write target sends people to edit a file that may not even exist.
      const envPath = projectEnv.apiKeyPath ?? resolveProjectEnvPath(options.installDir);
      ui.log.warn(`${envPath} already has WORKOS_API_KEY — not provisioning a new environment.`);
      return false;
    }

    const result = await provisionUnclaimedEnvironment();

    // Write .env.local first — if this fails, config stays clean (no orphan entries)
    const envVars: Record<string, string> = {
      WORKOS_API_KEY: result.apiKey,
      WORKOS_CLIENT_ID: result.clientId,
      WORKOS_CLAIM_TOKEN: result.claimToken,
    };

    if (options.redirectUri) {
      const key = options.redirectUriKey ?? 'WORKOS_REDIRECT_URI';
      envVars[key] = options.redirectUri;
    }

    writeCredentialsEnv(options.installDir, envVars);

    // Save to config store (after .env.local succeeds). A fresh key so a repeated
    // provision never clobbers an earlier env's claim token (unrecoverable — it
    // lives only in this config).
    const config: CliConfig = getConfig() ?? { environments: {} };
    const key = freshEnvKey(config, 'unclaimed');
    config.environments[key] = {
      name: key,
      type: 'unclaimed',
      apiKey: result.apiKey,
      clientId: result.clientId,
      claimToken: result.claimToken,
    };
    config.activeEnvironment = key;
    saveConfig(config);

    // Verify config persisted — critical for `workos env claim` in a later process
    const readBack = getActiveEnvironment();
    if (!readBack || readBack.type !== 'unclaimed') {
      logError('[unclaimed-env-provision] Config read-back failed after save — claim token may not persist');
      ui.log.warn('Environment provisioned but config storage may be unreliable. Falling back to login...');
      return false;
    }

    logInfo('[unclaimed-env-provision] Unclaimed environment provisioned and saved');
    renderStderrNotice(
      `${chalk.green('✓')} ${chalk.bold('Environment provisioned')} ${chalk.dim('— credentials saved to your project')}`,
      `${chalk.dim('Run')} ${chalk.bold.cyan(formatWorkOSCommand('env claim'))} ${chalk.dim('to link it to your account.')}`,
    );

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[unclaimed-env-provision] Failed:', message);

    if (error instanceof UnclaimedEnvApiError) {
      if (error.statusCode === 429) {
        ui.log.warn('WorkOS is busy, falling back to login...');
      }
    } else {
      // Non-API errors (filesystem, keyring) are unexpected — surface to user
      ui.log.warn(`Could not set up environment: ${message}. Falling back to login...`);
    }

    return false;
  }
}
