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
 */

import { homedir } from 'node:os';
import ui, { isCancel } from '../utils/ui.js';
import { outputSuccess, exitWithError, isJsonMode } from '../utils/output.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
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
  /** Deadline signal — aborts a hung prompt (used by maybeRunSetupAfter). */
  signal?: AbortSignal;
}

/**
 * Deadline that bounds the interactive prompt (via AbortSignal) so an
 * unanswered prompt can never wedge login/install. Once the user consents, the
 * install itself runs to completion — it is not raced.
 */
export const SETUP_OFFER_TIMEOUT_MS = 30 * 1000;

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
  } else if (!isPromptAllowed() && !opts.assumeYes) {
    // Explicit `workos setup` in a non-interactive context needs --yes.
    exitWithError({
      code: 'confirmation_required',
      message: `Interactive setup needs a TTY. Re-run \`${formatWorkOSCommand('setup --yes')}\` to install non-interactively.`,
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

    const answer = await ui.confirm({ message: 'Set up now?', initialValue: true, signal: opts.signal });
    // Cancel (ctrl-c / deadline) is not a decline — skip silently, ask again next time.
    if (isCancel(answer)) return;
    if (!answer) {
      if (!isCommand) recordSetupDeclined();
      emitSetupEvent(opts.trigger, startedAt, false, { skills: [], mcpInstalled: [], mcpFailed: [] });
      ui.log.hint(`No problem. Run \`${formatWorkOSCommand('setup')}\` anytime.`);
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

  recordSetupCompleted();

  const mcpInstalled = mcpResults
    .filter((r) => r.outcome === 'installed' || r.outcome === 'already-installed')
    .map((r) => r.agent);
  const mcpFailed = mcpResults.filter((r) => r.outcome === 'failed').map((r) => r.agent);

  emitSetupEvent(opts.trigger, startedAt, true, {
    skills: skillResult?.agents.map((a) => a.name) ?? [],
    mcpInstalled,
    mcpFailed,
  });

  reportResults(skillResult ? { agents: skillAgentNames, count: skillResult.skills.length } : null, mcpResults);
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
      const line = `MCP server: ${r.displayName} — ${MCP_OUTCOME_LABELS[r.outcome]}`;
      if (r.outcome === 'failed') {
        ui.log.error(r.error ? `${line} (${r.error})` : line);
      } else {
        ui.log.success(line);
      }
    }
    if (mcp.some((r) => r.outcome === 'installed' || r.outcome === 'already-installed')) {
      ui.log.hint('Your agent will authorize WorkOS via OAuth on first MCP use.');
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
function emitSetupEvent(
  trigger: SetupTrigger,
  startedAt: number,
  accepted: boolean,
  agents: { skills: string[]; mcpInstalled: string[]; mcpFailed: string[] },
): void {
  analytics.emitCommandEvent('setup offer', Date.now() - startedAt, agents.mcpFailed.length === 0, {
    extraAttributes: {
      'setup.trigger': trigger,
      'setup.accepted': accepted,
      'setup.skills_agents': agents.skills.join(','),
      'setup.mcp_installed': agents.mcpInstalled.join(','),
      'setup.mcp_failed': agents.mcpFailed.join(','),
    },
  });
}

/**
 * Best-effort setup offer after a successful `login` / `install`.
 *
 * Never throws into, wedges, or fails the parent flow: a try/catch swallows any
 * error, and the deadline aborts the interactive prompt (AbortSignal → CANCEL,
 * which releases stdin). The prompt is the only unbounded wait — detection and
 * install are internally time-bounded — so aborting it is sufficient; the offer
 * is NOT raced, so a consented install always runs to completion. The parent
 * flow has already succeeded by the time this runs.
 */
export async function maybeRunSetupAfter(trigger: 'login' | 'install'): Promise<void> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), SETUP_OFFER_TIMEOUT_MS);
  timer.unref?.();
  try {
    await runSetup({ trigger, signal: deadline.signal });
  } catch {
    // Setup must never fail or block login / install.
  } finally {
    clearTimeout(timer);
  }
}
