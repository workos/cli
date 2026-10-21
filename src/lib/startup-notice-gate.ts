/**
 * One-notice-per-run coordinator for the startup stderr notices.
 *
 * Three middlewares can each want to print a one-line stderr notice at startup:
 * the first-run telemetry notice, the unclaimed-environment warning, and the
 * MCP banner. Stacking two or three boxes on a single command is noise, so this
 * module is the shared latch — whichever fires first calls
 * markStartupNoticeShown(), and the lower-priority MCP banner checks
 * hasStartupNoticeShown() and defers.
 *
 * Ordering IS priority: bin.ts runs the telemetry + unclaimed middlewares before
 * the MCP banner middleware, so those two always win a contested run. In-memory
 * only (a run is a single CLI process); the per-machine "already shown" state is
 * persisted separately by each notice.
 */

let shown = false;

/** Record that a startup notice has displayed this run. */
export function markStartupNoticeShown(): void {
  shown = true;
}

/** Whether any startup notice has already displayed this run. */
export function hasStartupNoticeShown(): boolean {
  return shown;
}

/** Reset the latch (for testing). */
export function resetStartupNoticeGate(): void {
  shown = false;
}
