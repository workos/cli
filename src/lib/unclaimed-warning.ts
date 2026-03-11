/**
 * Unclaimed environment warning module.
 *
 * Shows a one-line stderr warning when the active environment is unclaimed.
 * Never throws — all errors are caught to avoid blocking management commands.
 */

import chalk from 'chalk';
import { getActiveEnvironment, isUnclaimedEnvironment } from './config-store.js';
import { isJsonMode } from '../utils/output.js';
import { renderStderrBox } from '../utils/box.js';

let warningShownThisSession = false;

/**
 * Show a warning if the active environment is unclaimed.
 * Non-blocking — never throws.
 */
export async function warnIfUnclaimed(): Promise<void> {
  try {
    const env = getActiveEnvironment();
    if (!env || !isUnclaimedEnvironment(env)) return;

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
}
