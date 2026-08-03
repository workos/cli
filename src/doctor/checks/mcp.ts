import { detectMcpClients } from '../../lib/mcp-clients.js';
import { MCP_DOCS_URL, MCP_SERVER_URL } from '../../lib/constants.js';
import type { McpInfo, McpAgentMcpStatus } from '../types.js';

/**
 * Report the WorkOS MCP server status across detected coding agents.
 *
 * Mirrors checkSkills: per-detected-agent loop, typed `*Info` return, null when
 * no agents are detected (so doctor renders no MCP section for users with no
 * coding agent installed). Report-only — never mutates config (`--fix` does not
 * touch MCP in this phase).
 *
 * Absent MCP is deliberately NOT an issue: the user may have declined the
 * offer. URL drift ("misconfigured") is detected when a client exposes its
 * effective URL; issues.ts derives a warning from it. Per-agent shell-outs
 * carry the 10s timeout from the client library, keeping doctor fast.
 *
 * A configured entry is annotated `not-verified` whenever the client cannot
 * report its OAuth state — a client capability, never a hardcoded agent name,
 * so the caveat is applied uniformly instead of singling out the one client we
 * happen to have written recovery steps for.
 */
export async function checkMcp(): Promise<McpInfo | null> {
  const clients = await detectMcpClients();
  if (clients.length === 0) return null;

  const agents = await Promise.all(
    clients.map(async (client): Promise<McpAgentMcpStatus> => {
      const configured = await client.isInstalled();
      const status: McpAgentMcpStatus = {
        agent: client.displayName,
        available: true,
        configured,
        installed: configured,
      };
      if (configured) {
        const url = await client.getConfiguredUrl();
        status.misconfigured = url !== null && url !== MCP_SERVER_URL;
        if (!client.authenticationVerifiable) status.authentication = 'not-verified';
      }
      return status;
    }),
  );

  return { serverUrl: MCP_SERVER_URL, docsUrl: MCP_DOCS_URL, agents };
}
