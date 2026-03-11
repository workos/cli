/**
 * Unclaimed environment warning module.
 *
 * Shows a one-line stderr warning when the active environment is unclaimed.
 * Lazily checks claimed status via createClaimNonce() once per session.
 * Never throws — all errors are caught to avoid blocking management commands.
 */

import chalk from 'chalk';
import { getActiveEnvironment, isUnclaimedEnvironment } from './config-store.js';
import { createClaimNonce } from './unclaimed-env-api.js';
import { markEnvironmentClaimed } from '../commands/claim.js';
import { logInfo } from '../utils/debug.js';
import { isJsonMode } from '../utils/output.js';

let warningShownThisSession = false;
let claimCheckDoneThisSession = false;

/**
 * Show a warning if the active environment is unclaimed.
 * Optionally checks if the environment has been claimed since last check.
 * Non-blocking — never throws.
 */
export async function warnIfUnclaimed(): Promise<void> {
  try {
    const env = getActiveEnvironment();
    if (!env || !isUnclaimedEnvironment(env)) return;

    // Lazy claim detection — check once per session
    if (!claimCheckDoneThisSession && env.claimToken && env.clientId) {
      claimCheckDoneThisSession = true;
      try {
        const result = await createClaimNonce(env.clientId, env.claimToken);
        if (result.alreadyClaimed) {
          markEnvironmentClaimed();
          logInfo('[unclaimed-warning] Environment was claimed, config updated');
          return; // No warning needed
        }
      } catch {
        // API check failed — still show warning
      }
    }

    // Show warning once per session
    if (warningShownThisSession) return;
    warningShownThisSession = true;

    if (!isJsonMode()) {
      const inner = ` ${chalk.yellow('⚠ Unclaimed environment')} — Run ${chalk.cyan('workos claim')} to keep your data. `;
      // Strip ANSI for border width calculation
      const plainLen = inner.replace(/\x1b\[[0-9;]*m/g, '').length;
      const border = '─'.repeat(plainLen);
      console.error('');
      console.error(chalk.yellow(`  ┌${border}┐`));
      console.error(chalk.yellow('  │') + inner + chalk.yellow('│'));
      console.error(chalk.yellow(`  └${border}┘`));
      console.error('');
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
