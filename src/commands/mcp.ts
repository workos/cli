import ui from '../utils/ui.js';
import { outputSuccess, outputJson, outputTable, exitWithError, isJsonMode } from '../utils/output.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import {
  createMcpClients,
  detectMcpClients,
  MCP_AGENT_KEYS,
  MCP_OUTCOME_LABELS,
  type McpAgentKey,
  type McpClientResult,
} from '../lib/mcp-clients.js';
import { MCP_DOCS_URL, MCP_SERVER_URL } from '../lib/constants.js';

/**
 * `workos mcp install | remove | status` handlers.
 *
 * Thin callers over `lib/mcp-clients.ts`: detect the clients, run the
 * operation, and format the per-agent matrix in both output modes. No prompts
 * (non-TTY-safe by construction) and no auth guard — the WorkOS MCP server is
 * secret-free, so configuring it never needs an API key.
 */

export interface McpCommandOptions {
  agent?: string[];
}

/**
 * Validate `--agent` values against known keys. Unknown values exit with a
 * structured `unknown_agent` error. Returns undefined (no filter) when none
 * were passed, so callers act on all detected agents.
 */
function resolveAgentFilter(agent?: string[]): McpAgentKey[] | undefined {
  if (!agent || agent.length === 0) return undefined;
  const unknown = agent.filter((a) => !MCP_AGENT_KEYS.includes(a as McpAgentKey));
  if (unknown.length > 0) {
    exitWithError({
      code: 'unknown_agent',
      message: `Unknown agent(s): ${unknown.join(', ')}. Supported: ${MCP_AGENT_KEYS.join(', ')}.`,
    });
  }
  return agent as McpAgentKey[];
}

/** Zero detected agents: same message + exit 0 for both install and remove. */
function reportNoAgents(): void {
  if (isJsonMode()) {
    outputSuccess('No supported coding agents detected', { agents: [] });
  } else {
    ui.log.info('No supported coding agents detected (looked for Claude Code, Codex, Cursor).');
  }
}

/**
 * Emit the per-agent matrix, then exit non-zero if any agent failed. The full
 * matrix is always emitted first so partial success is still fully reported.
 */
function reportResults(message: string, results: McpClientResult[]): void {
  if (isJsonMode()) {
    outputSuccess(message, { agents: results });
  } else {
    for (const r of results) {
      const scope = r.configuration ? ` (${r.configuration.scope} scope)` : '';
      const line = `${r.displayName}: ${MCP_OUTCOME_LABELS[r.outcome]}${scope}`;
      if (r.outcome === 'failed') {
        ui.log.error(r.error ? `${line} — ${r.error}` : line);
      } else if (r.outcome === 'installed' || r.outcome === 'removed' || r.outcome === 'already-installed') {
        ui.log.success(line);
      } else {
        ui.log.info(line);
      }
    }
    reportRecovery(results);
  }

  if (results.some((r) => r.outcome === 'failed')) {
    exitWithCode(ExitCode.GENERAL_ERROR);
  }
}

function reportRecovery(results: McpClientResult[]): void {
  for (const result of results) {
    if (!result.recovery || !result.configuration) continue;
    if (result.configuration.authentication === 'action-required') {
      ui.log.warn(`${result.displayName}: configuration was written, but OAuth did not complete in this process.`);
    } else {
      ui.log.info(`${result.displayName}: configuration does not prove that OAuth is complete.`);
    }
    for (const hint of result.recovery.hints) {
      ui.log.hint(hint.command ? `${hint.description}: ${hint.command}` : hint.description);
    }
    ui.log.hint(`Setup and recovery guide: ${result.recovery.docsUrl}`);
  }
}

export async function runMcpInstall(options: McpCommandOptions = {}): Promise<void> {
  const filter = resolveAgentFilter(options.agent);
  const clients = await detectMcpClients(filter);
  if (clients.length === 0) {
    reportNoAgents();
    return;
  }
  const results: McpClientResult[] = [];
  for (const client of clients) {
    results.push(await client.add());
  }
  reportResults('Configured WorkOS MCP server', results);
}

export async function runMcpRemove(options: McpCommandOptions = {}): Promise<void> {
  const filter = resolveAgentFilter(options.agent);
  const clients = await detectMcpClients(filter);
  if (clients.length === 0) {
    reportNoAgents();
    return;
  }
  const results: McpClientResult[] = [];
  for (const client of clients) {
    results.push(await client.remove());
  }
  reportResults('Removed WorkOS MCP server', results);
}

export async function runMcpStatus(): Promise<void> {
  // Status lists every known agent (not just available ones) with its
  // availability + install flags, so `createMcpClients()` — not
  // `detectMcpClients()` — is the right source here.
  const clients = createMcpClients();
  const agents = await Promise.all(
    clients.map(async (client) => {
      const available = await client.isAvailable();
      const configured = available ? await client.isInstalled() : false;
      const configuredUrl = configured ? await client.getConfiguredUrl() : null;
      const endpointValid = configuredUrl === null ? null : configuredUrl === MCP_SERVER_URL;
      const authentication = client.key === 'codex' && configured ? 'not-verified' : null;
      return {
        agent: client.key,
        displayName: client.displayName,
        available,
        configured,
        // Retained for compatibility with existing JSON consumers.
        installed: configured,
        configuredUrl,
        endpointValid,
        authentication,
      };
    }),
  );

  if (isJsonMode()) {
    outputJson({ data: { agents } });
    return;
  }

  outputTable(
    [{ header: 'Agent' }, { header: 'Available' }, { header: 'Configured' }, { header: 'Authentication' }],
    agents.map((a) => [
      a.displayName,
      a.available ? 'yes' : 'no',
      a.configured ? 'yes' : 'no',
      a.configured ? (a.authentication ?? 'client-managed') : '—',
    ]),
  );

  if (agents.some((agent) => agent.authentication === 'not-verified')) {
    ui.log.hint(`Codex OAuth is not verified by this command. Run: codex mcp login workos`);
    ui.log.hint(`Setup and recovery guide: ${MCP_DOCS_URL}`);
  }
}
