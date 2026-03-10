/**
 * One-shot environment provisioning helper.
 *
 * Calls the one-shot API, saves credentials to config store as type 'unclaimed',
 * and returns whether provisioning succeeded. Non-fatal — wraps everything in
 * try/catch so install flow can fall back to login.
 */

import { provisionOneShotEnvironment, generateCookiePassword } from './one-shot-api.js';
import { getConfig, saveConfig } from './config-store.js';
import type { CliConfig } from './config-store.js';
import { writeEnvLocal } from './env-writer.js';
import { logInfo, logError } from '../utils/debug.js';
import clack from '../utils/clack.js';

export interface OneShotProvisionOptions {
  installDir: string;
  /** Redirect URI key name varies by framework */
  redirectUriKey?: string;
  /** Redirect URI value */
  redirectUri?: string;
}

/**
 * Try to provision a one-shot environment. Non-fatal — returns true on success,
 * false on any failure.
 *
 * On success:
 * - Saves environment to config store as type 'unclaimed'
 * - Sets it as active environment
 * - Writes credentials (including cookie password and claim token) to .env.local
 */
export async function tryOneShotProvision(options: OneShotProvisionOptions): Promise<boolean> {
  try {
    logInfo('[one-shot-provision] Attempting one-shot provisioning');

    const result = await provisionOneShotEnvironment();
    const cookiePassword = generateCookiePassword();

    // Save to config store
    const config: CliConfig = getConfig() ?? { environments: {} };
    config.environments['one-shot'] = {
      name: 'one-shot',
      type: 'unclaimed',
      apiKey: result.apiKey,
      clientId: result.clientId,
      claimToken: result.claimToken,
    };
    config.activeEnvironment = 'one-shot';
    saveConfig(config);

    // Write to .env.local
    const envVars: Record<string, string> = {
      WORKOS_API_KEY: result.apiKey,
      WORKOS_CLIENT_ID: result.clientId,
      WORKOS_COOKIE_PASSWORD: cookiePassword,
      WORKOS_CLAIM_TOKEN: result.claimToken,
    };

    if (options.redirectUri) {
      const key = options.redirectUriKey ?? 'WORKOS_REDIRECT_URI';
      envVars[key] = options.redirectUri;
    }

    writeEnvLocal(options.installDir, envVars);

    logInfo('[one-shot-provision] One-shot environment provisioned and saved');
    clack.log.info("Provisioned temporary environment. Run 'workos claim' to keep it.");

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError('[one-shot-provision] Failed:', message);

    // Provide user-friendly hint based on error type
    if (message.includes('Rate limited')) {
      clack.log.warn('WorkOS is busy, falling back to login...');
    }

    return false;
  }
}
