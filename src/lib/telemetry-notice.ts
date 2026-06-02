/**
 * First-run telemetry notice.
 *
 * Prints a one-time, stderr-only box telling the user that anonymous CLI usage
 * telemetry is being collected and how to turn it off. Shown at most once ever
 * (backed by the persisted `noticeShownAt` timestamp in preferences.json), only
 * in interactive human mode, and never on the machine-readable path.
 *
 * Mirrors the structural pattern of unclaimed-warning.ts: a per-session guard,
 * a `!isJsonMode()` gate, the shared renderStderrBox helper, and a never-throws
 * contract so it can never block command execution. The one structural
 * difference is persistence — this notice writes `noticeShownAt` the first time
 * it actually displays so it never re-shows across runs.
 */

import chalk from 'chalk';
import { isJsonMode } from '../utils/output.js';
import { renderStderrBox } from '../utils/box.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { isNoticeShown, markNoticeShown, isTelemetryOptedOut } from './preferences.js';

let shownThisSession = false;

/**
 * Show the first-run telemetry notice if it has never been displayed.
 *
 * Gate order is load-bearing: every suppression check runs BEFORE
 * markNoticeShown(), so a non-human first run (--json / piped / CI) never
 * consumes the one-time display. The flag is set only when the box is actually
 * rendered, so a real human eventually sees it. Never throws.
 */
export function maybeShowTelemetryNotice(): void {
  try {
    if (shownThisSession) return;
    if (isJsonMode()) return; // suppress in --json / non-TTY / CI (output auto-switches to json)
    if (isTelemetryOptedOut()) return; // already opted out — nothing to inform
    if (isNoticeShown()) return; // already shown once, ever

    const optOut = chalk.cyan(formatWorkOSCommand('telemetry opt-out'));
    const inner = ` ${chalk.cyan('ℹ')} WorkOS collects anonymous CLI usage telemetry. Run ${optOut} to disable it. `;
    renderStderrBox(inner, chalk.cyan);
    // Set the per-session guard and persist ONLY after a successful render, so a
    // render failure (caught below) lets a later command in this process retry
    // rather than silently suppressing the notice for the rest of the session.
    shownThisSession = true;
    markNoticeShown();
  } catch {
    // Never block command execution.
  }
}

/** Reset session state (for testing). */
export function resetTelemetryNoticeState(): void {
  shownThisSession = false;
}
