/**
 * Unclaimed environment provisioning helper.
 *
 * Calls the unclaimed env API, saves credentials to config store as type 'unclaimed',
 * and returns whether provisioning succeeded. Non-fatal — wraps everything in
 * try/catch so install flow can fall back to login.
 */

import chalk from 'chalk';
import { provisionUnclaimedEnvironment, UnclaimedEnvApiError } from './unclaimed-env-api.js';
import { getConfig, saveConfig, getActiveEnvironment } from './config-store.js';
import type { CliConfig } from './config-store.js';
import { writeCredentialsEnv } from './env-writer.js';
import { logInfo, logError } from '../utils/debug.js';
import { renderStderrBox } from '../utils/box.js';
import clack from '../utils/clack.js';

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

    // Save to config store (after .env.local succeeds)
    const config: CliConfig = getConfig() ?? { environments: {} };
    config.environments['unclaimed'] = {
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: result.apiKey,
      clientId: result.clientId,
      claimToken: result.claimToken,
    };
    config.activeEnvironment = 'unclaimed';
    saveConfig(config);

    // Verify config persisted — critical for `workos env claim` in a later process
    const readBack = getActiveEnvironment();
    if (!readBack || readBack.type !== 'unclaimed') {
      logError('[unclaimed-env-provision] Config read-back failed after save — claim token may not persist');
      clack.log.warn('Environment provisioned but config storage may be unreliable. Falling back to login...');
      return false;
    }

    logInfo('[unclaimed-env-provision] Unclaimed environment provisioned and saved');
    const inner = ` ✓ ${chalk.green('Environment provisioned')} — Run ${chalk.cyan('workos env claim')} to keep it. `;
    renderStderrBox(inner, chalk.green);

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[unclaimed-env-provision] Failed:', message);

    if (error instanceof UnclaimedEnvApiError) {
      if (error.statusCode === 429) {
        clack.log.warn('WorkOS is busy, falling back to login...');
      }
    } else {
      // Non-API errors (filesystem, keyring) are unexpected — surface to user
      clack.log.warn(`Could not set up environment: ${message}. Falling back to login...`);
    }

    return false;
  }
}
