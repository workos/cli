/**
 * Unclaimed environment warning module.
 *
 * Shows a one-line stderr warning when the active environment is unclaimed.
 * On first run, checks if the environment was claimed externally (e.g. via
 * browser) and updates the local config if so.
 * Never throws — all errors are caught to avoid blocking management commands.
 */

import chalk from 'chalk';
import { getActiveEnvironment, isUnclaimedEnvironment, markEnvironmentClaimed } from './config-store.js';
import { createClaimNonce, UnclaimedEnvApiError } from './unclaimed-env-api.js';
import { logError, logInfo } from '../utils/debug.js';
import { isJsonMode } from '../utils/output.js';
import { renderStderrBox } from '../utils/box.js';

let warningShownThisSession = false;
let claimCheckDoneThisSession = false;

/**
 * Show a warning if the active environment is unclaimed.
 * Non-blocking — never throws.
 */
export async function warnIfUnclaimed(): Promise<void> {
  try {
    const env = getActiveEnvironment();
    if (!env || !isUnclaimedEnvironment(env)) return;

    // Check once per session if the env was claimed externally
    // claimToken and clientId guaranteed present by UnclaimedEnvironmentConfig
    if (!claimCheckDoneThisSession) {
      claimCheckDoneThisSession = true;
      try {
        const result = await createClaimNonce(env.clientId, env.claimToken);
        if (result.alreadyClaimed) {
          markEnvironmentClaimed();
          logInfo('[unclaimed-warning] Environment was claimed externally, config updated');
          return;
        }
      } catch (error) {
        if (error instanceof UnclaimedEnvApiError && error.statusCode === 401) {
          // 401 likely means the claim token was invalidated after the environment
          // was claimed. We assume claimed and promote to sandbox.
          markEnvironmentClaimed();
          logInfo('[unclaimed-warning] Claim token invalid/expired, removed');
          return;
        }
        // Log non-401 errors for diagnostics, then fall through to show warning
        if (error instanceof UnclaimedEnvApiError) {
          logError('[unclaimed-warning] Claim check failed:', error.statusCode, error.message);
        } else {
          logError('[unclaimed-warning] Claim check failed:', error instanceof Error ? error.message : String(error));
        }
      }
    }

    // Show warning once per session
    if (warningShownThisSession) return;
    warningShownThisSession = true;

    if (!isJsonMode()) {
      const inner = ` ${chalk.yellow('⚠ Unclaimed environment')} — Run ${chalk.cyan('workos env claim')} to keep your data. `;
      renderStderrBox(inner, chalk.yellow);
    }
  } catch (error) {
    // Never block command execution, but log for diagnostics
    logError('[unclaimed-warning] Unexpected error:', error instanceof Error ? error.message : String(error));
  }
}

/** Reset session state (for testing) */
export function resetUnclaimedWarningState(): void {
  warningShownThisSession = false;
  claimCheckDoneThisSession = false;
}
