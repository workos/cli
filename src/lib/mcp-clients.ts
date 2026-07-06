import { homedir } from 'os';
import { join } from 'path';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import * as jsonc from 'jsonc-parser';
import { execFileNoThrow } from '../utils/exec-file.js';
import { MCP_SERVER_NAME, MCP_SERVER_URL } from './constants.js';

/**
 * Client-writer library for the WorkOS MCP server.
 *
 * One `McpClientTarget` interface, three implementations. Claude Code and Codex
 * are configured by shelling out to their own CLIs (robust to their config
 * format changes); Cursor has no CLI, so we merge `~/.cursor/mcp.json` directly
 * with `jsonc-parser` (hand-edited files may contain comments / trailing
 * commas). Every operation degrades to a reported outcome — a missing binary,
 * an old client without HTTP-transport support, or an unparseable config is a
 * `failed`/`skipped`/`not-installed` result, never a thrown error.
 *
 * The library owns detection and per-client config writing; callers (the `mcp`
 * command today; install-flow / doctor in Phase 2) stay thin. Nothing here may
 * assume it runs inside the `mcp` command.
 */

/** 10s ceiling on every CLI shell-out so a hung client can't wedge the caller. */
const EXEC_TIMEOUT_MS = 10_000;

/** jsonc parse options: tolerate the comments / trailing commas real users
 * hand-edit into `~/.cursor/mcp.json`, and an empty file, so only genuinely
 * malformed JSON is flagged. */
const JSONC_PARSE_OPTIONS: jsonc.ParseOptions = {
  allowTrailingComma: true,
  allowEmptyContent: true,
};

const JSONC_MODIFY_OPTIONS: jsonc.ModificationOptions = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
};

export type McpAgentKey = 'claude-code' | 'codex' | 'cursor';

export type McpOutcome = 'installed' | 'already-installed' | 'removed' | 'not-installed' | 'skipped' | 'failed';

export interface McpClientResult {
  agent: McpAgentKey;
  displayName: string;
  outcome: McpOutcome;
  /** stderr/message excerpt when `outcome === 'failed'`. */
  error?: string;
}

export interface McpClientTarget {
  key: McpAgentKey;
  displayName: string;
  /** Agent is usable on this machine (config dir present AND, for CLI clients, binary runnable). */
  isAvailable(): Promise<boolean>;
  /** The WorkOS server is present in this client's config. */
  isInstalled(): Promise<boolean>;
  add(): Promise<McpClientResult>;
  remove(): Promise<McpClientResult>;
}

/** Stable list of known agent keys, for `--agent` validation by callers. */
export const MCP_AGENT_KEYS: McpAgentKey[] = ['claude-code', 'codex', 'cursor'];

/** Async existence check — `access` rejects with ENOENT when the path is missing. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Trim a shell-out message to a single-line excerpt for the `error` field. */
function excerpt(raw: string): string {
  const text = raw.trim();
  if (!text) return 'Unknown error';
  const firstLine = text.split('\n').find((l) => l.trim().length > 0) ?? text;
  return firstLine.trim().slice(0, 300);
}

/**
 * Does a CLI `mcp list` output contain our server?
 *
 * Matches the first whitespace-delimited token of any line (with an optional
 * trailing colon stripped), which covers both list shapes we support:
 *   - Claude Code:  `workos: https://mcp.workos.com/mcp (HTTP) - ✔ Connected`
 *   - Codex table:  `workos   https://mcp.workos.com/mcp   ...`
 *
 * First-token matching avoids the substring collision a naive
 * `output.includes('workos')` would hit on an unrelated `workos-docs` entry.
 */
function listHasServer(stdout: string, name: string): boolean {
  return stdout.split('\n').some((line) => {
    const firstToken = line.trim().split(/\s+/)[0] ?? '';
    return firstToken.replace(/:$/, '') === name;
  });
}

/**
 * Shared shell-out client for Claude Code and Codex. The two differ only in
 * binary name, config dir, and the `add` arg shape; every outcome-mapping rule
 * is identical, so they share one implementation.
 */
function createCliClient(config: {
  key: McpAgentKey;
  displayName: string;
  binary: string;
  configDir: string;
  addArgs: string[];
  removeArgs: string[];
}): McpClientTarget {
  const { key, displayName, binary, configDir, addArgs, removeArgs } = config;
  const result = (outcome: McpOutcome, error?: string): McpClientResult => ({
    agent: key,
    displayName,
    outcome,
    ...(error ? { error } : {}),
  });

  async function checkInstalled(): Promise<boolean> {
    const res = await execFileNoThrow(binary, ['mcp', 'list'], { timeout: EXEC_TIMEOUT_MS });
    if (res.status !== 0) return false;
    return listHasServer(res.stdout, MCP_SERVER_NAME);
  }

  return {
    key,
    displayName,
    async isAvailable() {
      // Two layers: the config dir can exist while the binary isn't on PATH,
      // and vice versa — require both before we try to shell out.
      if (!(await pathExists(join(homedir(), configDir)))) return false;
      const res = await execFileNoThrow(binary, ['--version'], { timeout: EXEC_TIMEOUT_MS });
      return res.status === 0;
    },
    isInstalled: checkInstalled,
    async add() {
      const res = await execFileNoThrow(binary, addArgs, { timeout: EXEC_TIMEOUT_MS });
      if (res.status === 0) return result('installed');
      // Idempotent: an "already exists" collision is a success, not a failure.
      const combined = `${res.stdout}\n${res.stderr}`.toLowerCase();
      if (combined.includes('already exists') || combined.includes('already configured')) {
        return result('already-installed');
      }
      // A non-zero exit doesn't always mean the write failed: Codex persists the
      // server config and THEN starts an OAuth flow that blocks (no browser /
      // callback available here) until our timeout kills it with a non-zero
      // status. Confirm against the actual config before declaring failure —
      // more robust than matching each client's success wording.
      if (await checkInstalled()) return result('installed');
      // Otherwise a real failure — an old client lacking `--transport http` /
      // `--url`, a bad invocation, etc. Reported, never thrown.
      return result('failed', excerpt(res.stderr || res.stdout));
    },
    async remove() {
      const res = await execFileNoThrow(binary, removeArgs, { timeout: EXEC_TIMEOUT_MS });
      const combined = `${res.stdout}\n${res.stderr}`.toLowerCase();
      // Claude exits 1 and Codex exits 0 when the server is absent; both print
      // "No MCP server named ...". Treat either as an idempotent no-op.
      if (combined.includes('no mcp server')) return result('not-installed');
      if (res.status === 0) return result('removed');
      return result('failed', excerpt(res.stderr || res.stdout));
    },
  };
}

function createClaudeCodeClient(): McpClientTarget {
  return createCliClient({
    key: 'claude-code',
    displayName: 'Claude Code',
    binary: 'claude',
    configDir: '.claude',
    // User scope: the management MCP is account-level, not per-repo — project
    // scope would nag teammates via checked-in config.
    addArgs: ['mcp', 'add', '--transport', 'http', '--scope', 'user', MCP_SERVER_NAME, MCP_SERVER_URL],
    removeArgs: ['mcp', 'remove', '--scope', 'user', MCP_SERVER_NAME],
  });
}

function createCodexClient(): McpClientTarget {
  return createCliClient({
    key: 'codex',
    displayName: 'Codex',
    binary: 'codex',
    configDir: '.codex',
    addArgs: ['mcp', 'add', MCP_SERVER_NAME, '--url', MCP_SERVER_URL],
    removeArgs: ['mcp', 'remove', MCP_SERVER_NAME],
  });
}

/**
 * Cursor has no CLI, so we read-modify-write `~/.cursor/mcp.json` directly with
 * `jsonc-parser`, preserving existing servers, comments, and formatting.
 */
function createCursorClient(): McpClientTarget {
  const key: McpAgentKey = 'cursor';
  const displayName = 'Cursor';
  const cursorDir = () => join(homedir(), '.cursor');
  const configPath = () => join(cursorDir(), 'mcp.json');
  const result = (outcome: McpOutcome, error?: string): McpClientResult => ({
    agent: key,
    displayName,
    outcome,
    ...(error ? { error } : {}),
  });

  /** Read + parse the config. `parseError` is true only for genuinely malformed
   * JSON (not comments / trailing commas / empty). */
  async function readConfig(): Promise<{
    content: string;
    parsed: Record<string, unknown> | undefined;
    parseError: boolean;
    exists: boolean;
  }> {
    const path = configPath();
    if (!(await pathExists(path))) {
      return { content: '', parsed: undefined, parseError: false, exists: false };
    }
    const content = await readFile(path, 'utf8');
    const errors: jsonc.ParseError[] = [];
    const parsed = jsonc.parse(content, errors, JSONC_PARSE_OPTIONS) as Record<string, unknown> | undefined;
    return { content, parsed, parseError: errors.length > 0, exists: true };
  }

  function hasWorkosServer(parsed: Record<string, unknown> | undefined): boolean {
    const servers = parsed?.mcpServers;
    return Boolean(servers && typeof servers === 'object' && MCP_SERVER_NAME in (servers as object));
  }

  return {
    key,
    displayName,
    async isAvailable() {
      return pathExists(cursorDir());
    },
    async isInstalled() {
      try {
        const { parsed, parseError } = await readConfig();
        if (parseError) return false;
        return hasWorkosServer(parsed);
      } catch {
        return false;
      }
    },
    async add() {
      const path = configPath();
      try {
        const { content, parseError, exists } = await readConfig();
        // Never overwrite a file we couldn't parse — the user must fix it first.
        if (exists && parseError) {
          return result('failed', `Could not parse ${path}; fix it manually and retry.`);
        }
        await mkdir(cursorDir(), { recursive: true });
        // Converge to our URL — an existing `workos` key with a different URL is
        // overwritten (reported as `installed`).
        const edits = jsonc.modify(
          content,
          ['mcpServers', MCP_SERVER_NAME],
          { url: MCP_SERVER_URL },
          JSONC_MODIFY_OPTIONS,
        );
        await writeFile(path, jsonc.applyEdits(content, edits), 'utf8');
        return result('installed');
      } catch (error) {
        return result('failed', error instanceof Error ? error.message : 'Unknown error');
      }
    },
    async remove() {
      const path = configPath();
      try {
        const { content, parsed, parseError, exists } = await readConfig();
        if (!exists) return result('not-installed');
        if (parseError) {
          return result('failed', `Could not parse ${path}; fix it manually and retry.`);
        }
        if (!hasWorkosServer(parsed)) return result('not-installed');
        const edits = jsonc.modify(content, ['mcpServers', MCP_SERVER_NAME], undefined, JSONC_MODIFY_OPTIONS);
        await writeFile(path, jsonc.applyEdits(content, edits), 'utf8');
        return result('removed');
      } catch (error) {
        return result('failed', error instanceof Error ? error.message : 'Unknown error');
      }
    },
  };
}

/** The three client targets, in a stable order. */
export function createMcpClients(): McpClientTarget[] {
  return [createClaudeCodeClient(), createCodexClient(), createCursorClient()];
}

/**
 * The URL the WorkOS server is configured with in Cursor's `~/.cursor/mcp.json`,
 * or null when the file/entry is absent, unreadable, or unparseable.
 *
 * Cursor is the only client whose config we read directly (the CLI clients don't
 * expose per-entry URLs), so this powers doctor's URL-drift ("misconfigured")
 * check without a second jsonc reader duplicating the config schema. Read-only
 * and never throws — a problem reading just yields null.
 */
export async function getCursorConfiguredUrl(): Promise<string | null> {
  try {
    const path = join(homedir(), '.cursor', 'mcp.json');
    if (!(await pathExists(path))) return null;
    const content = await readFile(path, 'utf8');
    const parsed = jsonc.parse(content, [], JSONC_PARSE_OPTIONS) as Record<string, unknown> | undefined;
    const servers = parsed?.mcpServers as Record<string, unknown> | undefined;
    const entry = servers?.[MCP_SERVER_NAME] as { url?: unknown } | undefined;
    return typeof entry?.url === 'string' ? entry.url : null;
  } catch {
    return null;
  }
}

/**
 * Return only the clients available on this machine, optionally narrowed to
 * `agentFilter` keys. Availability is probed in parallel. An unknown filter key
 * simply matches nothing here — callers validate keys and surface the error.
 */
export async function detectMcpClients(agentFilter?: string[]): Promise<McpClientTarget[]> {
  const clients = createMcpClients();
  const filtered = agentFilter ? clients.filter((c) => agentFilter.includes(c.key)) : clients;
  const availability = await Promise.all(filtered.map((c) => c.isAvailable()));
  return filtered.filter((_, i) => availability[i]);
}
