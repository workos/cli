import { detectMcpClients, getCursorConfiguredUrl } from '../../lib/mcp-clients.js';
import { MCP_SERVER_URL } from '../../lib/constants.js';
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
 * offer. Only Cursor exposes a readable config, so URL drift ("misconfigured")
 * is detected for Cursor alone; issues.ts derives a warning from it. Per-agent
 * shell-outs carry the 10s timeout from the client library, keeping doctor fast.
 */
export async function checkMcp(): Promise<McpInfo | null> {
  const clients = await detectMcpClients();
  if (clients.length === 0) return null;

  const agents = await Promise.all(
    clients.map(async (client): Promise<McpAgentMcpStatus> => {
      const installed = await client.isInstalled();
      const status: McpAgentMcpStatus = { agent: client.displayName, available: true, installed };
      // Cursor is the only client whose config we can read, so it's the only
      // one we can flag for URL drift. A missing/unreadable URL (null) is not
      // "unexpected" — only a present-but-different URL counts.
      if (client.key === 'cursor' && installed) {
        const url = await getCursorConfiguredUrl();
        status.misconfigured = url !== null && url !== MCP_SERVER_URL;
      }
      return status;
    }),
  );

  return { serverUrl: MCP_SERVER_URL, agents };
}
