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
import { logInfo } from '../utils/debug.js';
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
    if (!claimCheckDoneThisSession && env.claimToken && env.clientId) {
      claimCheckDoneThisSession = true;
      try {
        const result = await createClaimNonce(env.clientId, env.claimToken);
        if (result.alreadyClaimed) {
          markEnvironmentClaimed();
          logInfo('[unclaimed-warning] Environment was claimed externally, config updated');
          return;
        }
      } catch (error) {
        // 401 = token invalid/expired — clean up, stop warning about claiming
        if (error instanceof UnclaimedEnvApiError && error.statusCode === 401) {
          markEnvironmentClaimed();
          logInfo('[unclaimed-warning] Claim token invalid/expired, removed');
          return;
        }
        // Other errors — still show warning
      }
    }

    // Show warning once per session
    if (warningShownThisSession) return;
    warningShownThisSession = true;

    if (!isJsonMode()) {
      const inner = ` ${chalk.yellow('⚠ Unclaimed environment')} — Run ${chalk.cyan('workos claim')} to keep your data. `;
      renderStderrBox(inner, chalk.yellow);
    }
  } catch {
    // Never block command execution
  }
}

/** Reset session state (for testing) */
export function resetUnclaimedWarningState(): void {
  warningShownThisSession = false;
  claimCheckDoneThisSession = false;
}
