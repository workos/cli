/**
 * `workos setup` — the consolidated, consented agent-setup moment.
 *
 * Owns BOTH surfaces that used to nag independently:
 *   - skills auto-install (previously silent + unconditional on login/install)
 *   - the MCP server offer (previously a separate prompt at end of `install`)
 *
 * One prompt, one place. It is called three ways:
 *   - trigger 'login' / 'install' → `maybeRunSetupAfter`, a best-effort hook that
 *     can never block or fail the parent flow, gated so it stays silent in
 *     agent/CI/non-TTY/JSON and never re-asks after a decline or completion.
 *   - trigger 'command' → the top-level `workos setup`, always runnable, with
 *     flags for granular / non-interactive use.
 *
 * The consent contract is the whole point: nothing is written to a coding agent
 * unless the user says yes (or passes --yes). This replaces the auto-install
 * that a customer called "prompt injection malware".
 *
 * AUTH-6734 policy: never install silently. The consent prompt defaults to No,
 * so an absent-minded Enter (or any non-answer) installs nothing; the only ways
 * anything lands are an explicit "yes" at the prompt or an explicit flag
 * (`workos setup --yes`, `workos skills install`, `workos mcp install`).
 */

import { homedir } from 'node:os';
import ui, { isCancel } from '../utils/ui.js';
import { outputSuccess, exitWithError, isJsonMode } from '../utils/output.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { CliExit } from '../utils/cli-exit.js';
import { isPromptAllowed } from '../utils/interaction-mode.js';
import {
  isSetupDeclined,
  isSetupCompleted,
  recordSetupDeclined,
  recordSetupCompleted,
  clearSetupDecline,
} from '../lib/preferences.js';
import { createAgents, detectAgents, refreshWorkOSSkills, type AgentConfig } from './install-skill.js';
import {
  detectMcpClients,
  MCP_AGENT_KEYS,
  MCP_OUTCOME_LABELS,
  type McpClientResult,
  type McpClientTarget,
} from '../lib/mcp-clients.js';
import { analytics } from '../utils/analytics.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

export type SetupTrigger = 'login' | 'install' | 'command';

export interface RunSetupOptions {
  trigger: SetupTrigger;
  /** Restrict to specific agent keys (e.g. claude-code, cursor). */
  agents?: string[];
  skillsOnly?: boolean;
  mcpOnly?: boolean;
  /** Skip the confirm and install directly (for non-interactive `workos setup --yes`). */
  assumeYes?: boolean;
  /** Clear a prior decline so automatic offers resume, then return. */
  reset?: boolean;
}

/** Validate an --agents filter against the known keys; exit with a structured error on unknown. */
function validateAgentFilter(agents: string[] | undefined, known: string[]): string[] | undefined {
  if (!agents || agents.length === 0) return undefined;
  const unknown = agents.filter((a) => !known.includes(a));
  if (unknown.length > 0) {
    exitWithError({
      code: 'unknown_agent',
      message: `Unknown agent(s): ${unknown.join(', ')}. Supported: ${known.join(', ')}.`,
    });
  }
  return agents;
}

/** Distinct display names across skill agents + MCP targets, for the offer copy. */
function detectedNames(skillAgents: AgentConfig[], mcpTargets: McpClientTarget[]): string[] {
  return Array.from(new Set([...skillAgents.map((a) => a.displayName), ...mcpTargets.map((t) => t.displayName)]));
}

/**
 * Run the consolidated setup flow. Behavior branches on `trigger`:
 *   - automatic (login/install): self-gates on mode + decline/complete, prompts,
 *     records an absolute decline on "no".
 *   - command: always runs; a "no" does NOT record a permanent decline.
 */
export async function runSetup(opts: RunSetupOptions): Promise<void> {
  if (opts.reset) {
    clearSetupDecline();
    if (isJsonMode()) {
      outputSuccess('Setup offers re-enabled', { reset: true });
    } else {
      ui.log.success(`Setup offers re-enabled. Run \`${formatWorkOSCommand('setup')}\` to configure your agents.`);
    }
    return;
  }

  const isCommand = opts.trigger === 'command';
  const agents = createAgents(homedir()); // cheap (path construction, no IO); built once
  const agentFilter = isCommand
    ? validateAgentFilter(opts.agents, [...Object.keys(agents), ...MCP_AGENT_KEYS])
    : opts.agents;

  // Gate BEFORE any agent detection — detectMcpClients shells out to `claude mcp
  // list` etc., so a machine / declined / completed run must pay nothing.
  if (!isCommand) {
    // Automatic (login/install): silent in machine/non-interactive contexts, and
    // never after a decline or a prior completion.
    if (isJsonMode() || !isPromptAllowed()) return;
    if (isSetupDeclined() || isSetupCompleted()) return;
  } else if ((!isPromptAllowed() || isJsonMode()) && !opts.assumeYes) {
    // Explicit `workos setup` can't prompt in a non-interactive context, nor
    // under --json — output mode is JSON while interaction mode stays human, so
    // isPromptAllowed() is still true and a confirm would pollute the
    // machine-readable stdout stream. Require --yes in both cases.
    exitWithError({
      code: 'confirmation_required',
      message: `Setup can't prompt here (non-interactive or --json). Re-run \`${formatWorkOSCommand('setup --yes')}\` to install without a prompt.`,
    });
  }

  const wantSkills = !opts.mcpOnly;
  const wantMcp = !opts.skillsOnly;
  const skillAgents: AgentConfig[] = wantSkills ? detectAgents(agents, agentFilter) : [];
  const mcpTargets: McpClientTarget[] = wantMcp ? await detectMcpClients(agentFilter) : [];
  const names = detectedNames(skillAgents, mcpTargets);

  // Nothing to install to. Surface it only for an explicit invocation.
  if (names.length === 0) {
    if (isCommand) {
      if (isJsonMode()) {
        outputSuccess('No supported coding agents detected', { agents: [] });
      } else {
        ui.log.info('No supported coding agents detected (looked for Claude Code, Codex, Cursor, Goose).');
      }
    }
    return;
  }

  const startedAt = Date.now();

  // The offer.
  if (!opts.assumeYes) {
    ui.heading('Set up your coding agent');
    const what =
      wantSkills && wantMcp ? 'WorkOS skills and the MCP server' : wantMcp ? 'the WorkOS MCP server' : 'WorkOS skills';
    ui.note(
      `Add ${what} to ${names.join(', ')} so your coding agent can\n` +
        `scaffold auth and manage WorkOS resources. Nothing is written until you confirm.`,
    );

    // Default MUST stay No (AUTH-6734): installation is opt-in only, so the
    // default answer — what an impatient Enter produces — installs nothing.
    const answer = await ui.confirm({ message: 'Set up now?', initialValue: false });
    // Cancel (ctrl-c) is not a decline — skip silently and ask again next time,
    // but record it so the cut-off is observable in telemetry.
    if (isCancel(answer)) {
      emitSetupEvent(opts.trigger, startedAt, 'cancelled', { skills: [], mcpInstalled: [], mcpFailed: [] });
      return;
    }
    if (!answer) {
      if (!isCommand) recordSetupDeclined();
      emitSetupEvent(opts.trigger, startedAt, 'declined', { skills: [], mcpInstalled: [], mcpFailed: [] });
      printManualInstallInstructions(wantSkills, wantMcp);
      return;
    }
  }

  // Install.
  await installAndReport(opts, skillAgents, mcpTargets, startedAt);
}

async function installAndReport(
  opts: RunSetupOptions,
  skillAgents: AgentConfig[],
  mcpTargets: McpClientTarget[],
  startedAt: number,
): Promise<void> {
  // Skills (local fs) and MCP (shell-outs to `claude mcp add` etc., which can
  // each block toward a 10s timeout) are independent — run them concurrently,
  // and run the per-agent MCP adds in parallel too. Empty inputs (skillsOnly /
  // mcpOnly) resolve to null / [] without work. `target.add()` never rejects.
  const [skillResult, mcpResults] = await Promise.all([
    skillAgents.length > 0 ? refreshWorkOSSkills({ agents: skillAgents }) : Promise.resolve(null),
    Promise.all(mcpTargets.map((target) => target.add())),
  ]);
  const skillAgentNames = skillResult?.agents.map((a) => a.displayName) ?? [];

  const mcpInstalled = mcpResults
    .filter((r) => r.outcome === 'installed' || r.outcome === 'already-installed')
    .map((r) => r.agent);
  const failedResults = mcpResults.filter((r) => r.outcome === 'failed');
  const mcpFailed = failedResults.map((r) => r.agent);
  // Carry a bounded, agent-tagged reason so the MCP-install failure CAUSE (not
  // just the count) is observable in telemetry. Already user-safe — the same
  // text is shown via ui.log.error.
  const mcpFailedReasons = failedResults.map((r) => `${r.agent}:${(r.error ?? '').slice(0, 120)}`).join('; ');

  // Only mark setup complete when something actually landed. A run where every
  // attempted install failed (e.g. transient `claude mcp add` timeouts, with no
  // skills to fall back on) must NOT be treated as done: isSetupCompleted()
  // suppresses every future automatic offer, so persisting completion here would
  // strand the user after a transient failure. Leave the pref unset so the next
  // login/install re-offers.
  if (skillAgentNames.length > 0 || mcpInstalled.length > 0) {
    recordSetupCompleted();
  }

  emitSetupEvent(opts.trigger, startedAt, 'accepted', {
    skills: skillResult?.agents.map((a) => a.name) ?? [],
    mcpInstalled,
    mcpFailed,
    mcpFailedReasons,
  });

  reportResults(skillResult ? { agents: skillAgentNames, count: skillResult.skills.length } : null, mcpResults);
}

/**
 * A decline is the safe default, not a dead end (AUTH-6734): always leave the
 * exact manual-install commands behind so opting in later is self-serve.
 * Scoped to what the offer actually covered (--skills-only / --mcp-only).
 */
function printManualInstallInstructions(wantSkills: boolean, wantMcp: boolean): void {
  ui.log.hint('Nothing was installed. To install later, run any of:');
  if (wantSkills && wantMcp) {
    ui.log.hint(`  ${formatWorkOSCommand('setup')}           skills + MCP server`);
  }
  if (wantSkills) {
    ui.log.hint(`  ${formatWorkOSCommand('skills install')}  skills only`);
  }
  if (wantMcp) {
    ui.log.hint(`  ${formatWorkOSCommand('mcp install')}     MCP server only`);
  }
}

interface SkillSummary {
  agents: string[];
  count: number;
}

/** Emit the outcome in both output modes; exit non-zero if any MCP install failed. */
function reportResults(skills: SkillSummary | null, mcp: McpClientResult[]): void {
  if (isJsonMode()) {
    outputSuccess('Setup complete', { skills, mcp });
  } else {
    if (skills && skills.agents.length > 0) {
      const word = skills.count === 1 ? 'skill' : 'skills';
      ui.log.success(`${skills.count} ${word} installed for ${skills.agents.join(', ')}`);
    }
    for (const r of mcp) {
      const scope = r.configuration ? ` (${r.configuration.scope} scope)` : '';
      const line = `MCP server: ${r.displayName} — ${MCP_OUTCOME_LABELS[r.outcome]}${scope}`;
      if (r.outcome === 'failed') {
        ui.log.error(r.error ? `${line} (${r.error})` : line);
      } else {
        ui.log.success(line);
      }
    }
    for (const result of mcp) {
      if (!result.recovery || !result.configuration) continue;
      if (result.configuration.authentication === 'action-required') {
        ui.log.hint(`${result.displayName} configuration was written, but OAuth still requires host-shell action.`);
      } else {
        ui.log.hint(`${result.displayName} configuration does not prove that OAuth is complete.`);
      }
      for (const hint of result.recovery.hints) {
        ui.log.hint(hint.command ? `${hint.description}: ${hint.command}` : hint.description);
      }
      ui.log.hint(`Setup and recovery guide: ${result.recovery.docsUrl}`);
    }
    if (mcp.some((r) => (r.outcome === 'installed' || r.outcome === 'already-installed') && r.recovery === undefined)) {
      ui.log.hint('Complete WorkOS OAuth in your agent before using the MCP server.');
    }
  }

  if (mcp.some((r) => r.outcome === 'failed')) {
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}

/**
 * Queued adoption event (NOT capture()): setup runs as a sub-step after the
 * installer session has ended, so folded session tags would never ship. A queued
 * command event rides the CLI's final flush (the same pattern the old
 * standalone MCP offer used).
 */
type SetupOutcome = 'accepted' | 'declined' | 'cancelled';

function emitSetupEvent(
  trigger: SetupTrigger,
  startedAt: number,
  outcome: SetupOutcome,
  agents: { skills: string[]; mcpInstalled: string[]; mcpFailed: string[]; mcpFailedReasons?: string },
): void {
  analytics.emitCommandEvent('setup offer', Date.now() - startedAt, agents.mcpFailed.length === 0, {
    extraAttributes: {
      'setup.trigger': trigger,
      // `accepted` kept for back-compat dashboards; `outcome` distinguishes a
      // deliberate "no" (declined) from a walk-away/ctrl-c (cancelled).
      'setup.accepted': outcome === 'accepted',
      'setup.outcome': outcome,
      'setup.skills_agents': agents.skills.join(','),
      'setup.mcp_installed': agents.mcpInstalled.join(','),
      'setup.mcp_failed': agents.mcpFailed.join(','),
      ...(agents.mcpFailedReasons ? { 'setup.mcp_failed_reasons': agents.mcpFailedReasons } : {}),
    },
  });
}

/**
 * Best-effort setup offer after a successful `login` / `install`.
 *
 * Never throws into, wedges, or fails the parent flow — a try/catch swallows any
 * error. The offer is only ever shown to a present human in an interactive TTY
 * (runSetup early-returns in every machine/non-interactive context), so the
 * confirm is NOT time-bounded: a question that auto-dismisses while the user is
 * reading it is exactly the "it asked but moved on" bug. @inquirer already
 * handles ctrl-c, and detection/install are internally time-bounded, so there is
 * nothing left to race. The parent flow has already succeeded by the time this
 * runs. Any failure is reported to telemetry before being swallowed.
 */
export async function maybeRunSetupAfter(trigger: 'login' | 'install'): Promise<void> {
  try {
    await runSetup({ trigger });
  } catch (error) {
    // reportResults exits non-zero via CliExit on a failed MCP add — that's an
    // intentional exit for the standalone command, not an exception to report
    // (and it stays swallowed here so it never fails the parent login/install).
    if (error instanceof CliExit) return;
    // Setup must never fail or block login / install — but don't drop the signal.
    analytics.captureException(error instanceof Error ? error : new Error(String(error)), {
      'setup.trigger': trigger,
    });
  }
}
