/**
 * MCP-install onboarding surfaces + their shared gate state.
 *
 * One module owns all automatic-ask state so the install-flow prompt and the
 * one-time banner can't drift apart. The decline contract is absolute: any
 * explicit "no" records `promptDeclined` and no automatic surface ever asks
 * again — `workos mcp install` stays available manually.
 *
 * Mirrors telemetry-notice.ts: persisted shown/declined state in the plain
 * prefs store, mode-gated display, and a never-throws contract so a notice can
 * never block or fail a command. The mode gate is the CLI's interaction-mode
 * system (isPromptAllowed / isHumanMode), which already folds in CI markers,
 * agent markers, and TTY state — non-TTY safety comes from using it.
 */

import chalk from 'chalk';
import clack from '../utils/clack.js';
import { isHumanMode, isPromptAllowed } from '../utils/interaction-mode.js';
import { isJsonMode } from '../utils/output.js';
import { renderStderrBox } from '../utils/box.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { analytics } from '../utils/analytics.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { detectMcpClients, type McpClientResult, type McpClientTarget } from './mcp-clients.js';
import { hasStartupNoticeShown, markStartupNoticeShown } from './startup-notice-gate.js';

export type McpAskState = { declined: boolean; bannerShown: boolean };

/**
 * Best-effort ceiling on the whole install-flow offer so a wedged prompt can
 * never hold up `workos install`. Mirrors login.ts's SKILL_INSTALL_TIMEOUT_MS.
 */
export const MCP_OFFER_TIMEOUT_MS = 30 * 1000;

let bannerShownThisSession = false;

/** Human phrasing for each install outcome shown in the accept matrix. */
const OUTCOME_LABEL: Record<McpClientResult['outcome'], string> = {
  installed: 'installed',
  'already-installed': 'already installed',
  removed: 'removed',
  'not-installed': 'not installed',
  skipped: 'skipped',
  failed: 'failed',
};

/**
 * Read the persisted automatic-ask state. Never throws — a missing/corrupt
 * prefs file degrades to "nothing recorded" so gating still works in-memory.
 */
export async function getMcpAskState(): Promise<McpAskState> {
  try {
    const prefs = await loadPreferences();
    return {
      declined: prefs.mcp?.promptDeclined === true,
      bannerShown: Boolean(prefs.mcp?.bannerShownAt),
    };
  } catch {
    return { declined: false, bannerShown: false };
  }
}

/**
 * Record an explicit decline. Absolute and permanent for automatic surfaces.
 * Write failures are swallowed: gating degrades to per-run memory, never
 * crashes a command.
 */
export async function recordMcpDeclined(): Promise<void> {
  try {
    savePreferences({ mcp: { promptDeclined: true } });
  } catch {
    // Swallow — a read-only prefs file must never break a command.
  }
}

/** Record that the one-time banner was shown, stamping the current time. */
export async function recordMcpBannerShown(): Promise<void> {
  try {
    savePreferences({ mcp: { bannerShownAt: new Date().toISOString() } });
  } catch {
    // Swallow — see recordMcpDeclined.
  }
}

/**
 * The detected agents that would actually receive an install: available on this
 * machine AND missing the WorkOS server. Empty when there is nothing to offer.
 * Never throws — detection failure yields an empty set.
 */
async function detectInstallTargets(): Promise<McpClientTarget[]> {
  try {
    const clients = await detectMcpClients();
    if (clients.length === 0) return [];
    const installed = await Promise.all(clients.map((c) => c.isInstalled()));
    return clients.filter((_, i) => !installed[i]);
  } catch {
    return [];
  }
}

/**
 * Would an automatic ask be appropriate right now? True only when the user has
 * not declined AND at least one detected agent lacks the server. Does NOT gate
 * on interaction mode — callers add that (isPromptAllowed for the prompt,
 * isHumanMode for the banner). Checks `declined` first so declined machines
 * never pay for the client shell-outs.
 */
export async function isAutoAskEligible(): Promise<boolean> {
  const { declined } = await getMcpAskState();
  if (declined) return false;
  const targets = await detectInstallTargets();
  return targets.length > 0;
}

/**
 * One-time stderr banner nudging the user toward `workos mcp install`. Shown at
 * most once per machine, only on a normal human-mode run, and never when an
 * earlier startup notice already fired this run (telemetry notice and unclaimed
 * warning take precedence). Records `bannerShownAt` before printing —
 * shown-once beats seen-once (a lost banner is fine; a nag loop is not). Never
 * throws.
 */
export async function maybeShowMcpNotice(): Promise<void> {
  try {
    if (bannerShownThisSession) return;
    if (!isHumanMode()) return; // suppress in agent / CI / non-TTY
    if (isJsonMode()) return; // never on the machine-readable path
    if (hasStartupNoticeShown()) return; // one-notice-per-run cap; telemetry/unclaimed win
    const { bannerShown } = await getMcpAskState();
    if (bannerShown) return; // already shown once, ever
    if (!(await isAutoAskEligible())) return; // declined, or nothing to offer

    // Claim the slot + persist BEFORE printing: a lost banner beats a nag loop.
    bannerShownThisSession = true;
    markStartupNoticeShown();
    await recordMcpBannerShown();

    // Impression event. Queued (not capture()d) so it rides the CLI's final
    // flush; capture() only folds session tags and no session exists here.
    analytics.emitCommandEvent('mcp offer', 0, true, {
      extraAttributes: { 'mcp.entry_point': 'banner', 'mcp.shown': true },
    });

    const cmd = chalk.cyan(formatWorkOSCommand('mcp install'));
    const inner = ` ${chalk.cyan('ℹ')} New: connect your coding agent to WorkOS. Run ${cmd} to add the WorkOS MCP server (Claude Code, Codex, Cursor). `;
    renderStderrBox(inner, chalk.cyan);
  } catch {
    // Never block command startup.
  }
}

/** Emit the per-agent install matrix (human mode) without ever exiting. */
function printInstallMatrix(results: McpClientResult[]): void {
  for (const r of results) {
    const line = `${r.displayName}: ${OUTCOME_LABEL[r.outcome]}`;
    if (r.outcome === 'failed') {
      clack.log.error(r.error ? `${line} — ${r.error}` : line);
    } else {
      clack.log.success(line);
    }
  }
}

/**
 * The real install-flow offer. Self-gating: renders nothing unless prompting is
 * allowed, the user hasn't declined, and there is at least one agent to install
 * to. On yes: install + print the matrix + emit the adoption event. On explicit
 * no: record the decline + emit (a decline is an adoption signal). On cancel
 * (ctrl-C): skip silently without recording — a cancel is not a decline.
 */
async function offerMcpInstall(): Promise<void> {
  if (!isPromptAllowed()) return; // the entire mode gate (CI / agent / non-TTY)
  if (isJsonMode()) return; // never prompt on the machine-readable path (e.g. `install --json` on a TTY)
  const { declined } = await getMcpAskState();
  if (declined) return; // decline is absolute
  const targets = await detectInstallTargets();
  if (targets.length === 0) return; // nothing to offer

  const names = targets.map((t) => t.displayName).join(', ');
  const offerStartedAt = Date.now();
  const answer = await clack.confirm({
    message: `Add the WorkOS MCP server to ${names}? Your coding agent gets tools to manage WorkOS resources (you'll authorize via OAuth on first use).`,
  });

  // Cancel (ctrl-C) is not a decline — skip silently, ask again next time.
  if (clack.isCancel(answer)) return;

  // Adoption events are queued command events, NOT capture(): the installer
  // session has already shut down by the time this offer runs (run-with-core
  // fires session.end in its finally), so folded tags would never ship. A
  // queued event rides the CLI's unconditional final flush (bin.ts) and the
  // store-forward exit handler covers anything the flush misses.
  if (!answer) {
    // Record the decline BEFORE anything else so a later crash can't re-ask.
    await recordMcpDeclined();
    // A decline is a completed interaction, not an error: success stays true.
    analytics.emitCommandEvent('mcp offer', Date.now() - offerStartedAt, true, {
      extraAttributes: {
        'mcp.entry_point': 'install-flow',
        'mcp.accepted': false,
        'mcp.agents_installed': '',
        'mcp.agents_failed': '',
      },
    });
    return;
  }

  const results: McpClientResult[] = [];
  for (const target of targets) {
    results.push(await target.add());
  }
  printInstallMatrix(results);

  const installed = results
    .filter((r) => r.outcome === 'installed' || r.outcome === 'already-installed')
    .map((r) => r.agent);
  const failed = results.filter((r) => r.outcome === 'failed').map((r) => r.agent);
  // success=false when any agent failed, so the offer surfaces as an error
  // span while mcp.agents_failed carries which ones.
  analytics.emitCommandEvent('mcp offer', Date.now() - offerStartedAt, failed.length === 0, {
    extraAttributes: {
      'mcp.entry_point': 'install-flow',
      'mcp.accepted': true,
      'mcp.agents_installed': installed.join(','),
      'mcp.agents_failed': failed.join(','),
    },
  });
}

/**
 * Offer to install the WorkOS MCP server at the end of `workos install`.
 *
 * Wraps offerMcpInstall best-effort: a try/catch AND a 30s unref'd-timeout race
 * (login.ts pattern) so the offer can never throw into, wedge, or fail the
 * install flow. `workos install` has already succeeded by the time this runs.
 */
export async function maybeOfferMcpInstall(_opts: { entryPoint: 'install-flow' }): Promise<void> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<void>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(), MCP_OFFER_TIMEOUT_MS);
      // Don't keep the event loop alive on this timer — the process should exit
      // as soon as everything else settles.
      timeoutHandle.unref?.();
    });
    await Promise.race([offerMcpInstall(), timeout]);
  } catch {
    // The MCP offer must never fail or block `workos install`.
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

/** Reset per-session banner state (for testing). */
export function resetMcpNoticeState(): void {
  bannerShownThisSession = false;
}
