import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir, tmpdir } from 'os';

// Mock the shell-out layer so Claude Code / Codex outcomes are scripted.
vi.mock('../utils/exec-file.js', () => ({
  execFileNoThrow: vi.fn(),
}));

// ui.log writes to the raw stdout/stderr streams (not console.*), so capture
// its human-mode output through a module mock instead of a console spy.
const { uiLogs } = vi.hoisted(() => ({ uiLogs: [] as string[] }));
vi.mock('../utils/ui.js', () => {
  const record = (msg: unknown) => {
    uiLogs.push(String(msg));
  };
  return {
    default: {
      log: { info: record, success: record, error: record, warn: record, hint: record, step: record, message: record },
    },
  };
});

// Point homedir at a real temp dir so Cursor's fs read-modify-write and the
// config-dir detection checks operate on disk without touching the real $HOME.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

const { execFileNoThrow } = await import('../utils/exec-file.js');
const { setOutputMode } = await import('../utils/output.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { createMcpClients, detectMcpClients, MCP_AGENT_KEYS } = await import('../lib/mcp-clients.js');
const { runMcpInstall, runMcpRemove, runMcpStatus } = await import('./mcp.js');

type ExecShape = { status: number; stdout?: string; stderr?: string };

/** Route exec calls; anything the impl doesn't override defaults to success. */
function mockExec(impl: (command: string, args: string[]) => ExecShape): void {
  vi.mocked(execFileNoThrow).mockImplementation((command: string, args: string[]) =>
    Promise.resolve({ status: 0, stdout: '', stderr: '', ...impl(command, args) }),
  );
}

function clientByKey(key: string) {
  const target = createMcpClients().find((c) => c.key === key);
  if (!target) throw new Error(`no client ${key}`);
  return target;
}

/** Grab a thrown CliExit (handlers exit by throwing, not returning). */
async function captureExit(fn: () => Promise<void>): Promise<InstanceType<typeof CliExit> | undefined> {
  try {
    await fn();
    return undefined;
  } catch (e) {
    if (e instanceof CliExit) return e;
    throw e;
  }
}

let testHome: string;
let consoleOutput: string[];

beforeEach(() => {
  vi.clearAllMocks();
  uiLogs.length = 0;
  testHome = mkdtempSync(join(tmpdir(), 'mcp-test-'));
  vi.mocked(homedir).mockReturnValue(testHome);
  // Default: every shell-out succeeds (overridden per test).
  mockExec(() => ({ status: 0 }));
  consoleOutput = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  rmSync(testHome, { recursive: true, force: true });
  setOutputMode('human');
  vi.restoreAllMocks();
});

function makeDir(name: string): void {
  mkdirSync(join(testHome, name), { recursive: true });
}

function cursorConfigPath(): string {
  return join(testHome, '.cursor', 'mcp.json');
}

function writeCursorConfig(content: string): void {
  makeDir('.cursor');
  writeFileSync(cursorConfigPath(), content, 'utf8');
}

describe('createMcpClients', () => {
  it('returns the three client targets in a stable order', () => {
    const clients = createMcpClients();
    expect(clients.map((c) => c.key)).toEqual(['claude-code', 'codex', 'cursor']);
  });

  it('exposes the known agent keys for validation', () => {
    expect(MCP_AGENT_KEYS).toEqual(['claude-code', 'codex', 'cursor']);
  });
});

describe('detectMcpClients', () => {
  it('reports a CLI client available only when dir AND binary are present', async () => {
    makeDir('.claude');
    mockExec((_c, args) => (args[0] === '--version' ? { status: 0 } : { status: 0 }));
    expect((await detectMcpClients(['claude-code'])).map((c) => c.key)).toEqual(['claude-code']);
  });

  it('reports a CLI client unavailable when the binary is missing', async () => {
    makeDir('.claude');
    mockExec((_c, args) => (args[0] === '--version' ? { status: 1, stderr: 'command not found' } : { status: 0 }));
    expect(await detectMcpClients(['claude-code'])).toEqual([]);
  });

  it('reports a CLI client unavailable when the config dir is missing', async () => {
    // No ~/.claude dir; binary would run, but the dir gate fails first.
    mockExec(() => ({ status: 0 }));
    expect(await detectMcpClients(['claude-code'])).toEqual([]);
  });

  it('detects Cursor from its config dir alone (no binary)', async () => {
    makeDir('.cursor');
    expect((await detectMcpClients(['cursor'])).map((c) => c.key)).toEqual(['cursor']);
  });

  it('narrows to the requested agent filter', async () => {
    makeDir('.claude');
    makeDir('.codex');
    makeDir('.cursor');
    const detected = await detectMcpClients(['cursor']);
    expect(detected.map((c) => c.key)).toEqual(['cursor']);
  });

  it('returns nothing for an unknown filter key', async () => {
    makeDir('.claude');
    expect(await detectMcpClients(['bogus'])).toEqual([]);
  });
});

describe('Claude Code client', () => {
  const claude = () => clientByKey('claude-code');

  it('add maps a clean exit to installed', async () => {
    mockExec(() => ({ status: 0 }));
    expect((await claude().add()).outcome).toBe('installed');
  });

  it('add maps an "already exists" collision to already-installed', async () => {
    mockExec(() => ({ status: 1, stderr: 'MCP server workos already exists in user scope' }));
    expect((await claude().add()).outcome).toBe('already-installed');
  });

  it('add maps a version gap (unknown --transport) to failed with an excerpt', async () => {
    mockExec(() => ({ status: 1, stderr: "error: unknown option '--transport'" }));
    const res = await claude().add();
    expect(res.outcome).toBe('failed');
    expect(res.error).toContain('--transport');
  });

  it('isInstalled matches the workos: list line', async () => {
    mockExec(() => ({
      status: 0,
      stdout: 'raindrop: https://x (HTTP)\nworkos: https://mcp.workos.com/mcp (HTTP) - Connected',
    }));
    expect(await claude().isInstalled()).toBe(true);
  });

  it('isInstalled does NOT match a workos-docs substring collision', async () => {
    mockExec(() => ({ status: 0, stdout: 'workos-docs: https://docs (HTTP) - Connected' }));
    expect(await claude().isInstalled()).toBe(false);
  });

  it('isInstalled is false when list itself fails', async () => {
    mockExec(() => ({ status: 1, stderr: 'boom' }));
    expect(await claude().isInstalled()).toBe(false);
  });

  it('remove maps a clean exit to removed', async () => {
    mockExec(() => ({ status: 0 }));
    expect((await claude().remove()).outcome).toBe('removed');
  });

  it('remove maps "No MCP server named" (exit 1) to not-installed', async () => {
    mockExec(() => ({ status: 1, stderr: 'No MCP server named "workos" in user scope' }));
    expect((await claude().remove()).outcome).toBe('not-installed');
  });
});

describe('Codex client', () => {
  const codex = () => clientByKey('codex');

  it('add maps a clean exit to configured with unverified OAuth metadata', async () => {
    mockExec(() => ({ status: 0 }));
    const result = await codex().add();
    expect(result).toMatchObject({
      outcome: 'installed',
      configuration: { scope: 'user', authentication: 'unknown' },
      recovery: {
        docsUrl: 'https://workos.com/docs/mcp',
        hints: expect.arrayContaining([
          expect.objectContaining({
            command: 'codex mcp login workos',
            hostShellRequired: true,
          }),
        ]),
      },
    });
  });

  it('add maps a version gap (unknown --url) to failed', async () => {
    mockExec(() => ({ status: 1, stderr: "error: unexpected argument '--url'" }));
    const res = await codex().add();
    expect(res.outcome).toBe('failed');
    expect(res.error).toContain('--url');
  });

  it('add reports configured with host action required when OAuth times out after persistence', async () => {
    // Codex writes the config, then its post-add OAuth flow blocks and times
    // out with a non-zero status — but `mcp list` proves the server landed.
    mockExec((_c, args) => {
      if (args.includes('add')) return { status: 1, stdout: "Added global MCP server 'workos'." };
      if (args.includes('list')) return { status: 0, stdout: 'workos  https://mcp.workos.com/mcp  enabled' };
      return { status: 0 };
    });
    expect(await codex().add()).toMatchObject({
      outcome: 'installed',
      configuration: { scope: 'user', authentication: 'action-required' },
    });
  });

  it('add stays failed on a non-zero exit when the server did NOT land', async () => {
    mockExec((_c, args) => {
      if (args.includes('add')) return { status: 1, stderr: 'boom' };
      if (args.includes('list')) return { status: 0, stdout: 'Name  Url\ngithub  https://x' };
      return { status: 0 };
    });
    expect((await codex().add()).outcome).toBe('failed');
  });

  it('isInstalled matches the codex table row (name in first column, no colon)', async () => {
    mockExec(() => ({
      status: 0,
      stdout: 'Name    Url\ngithub  https://api.github\nworkos  https://mcp.workos.com/mcp   enabled',
    }));
    expect(await codex().isInstalled()).toBe(true);
  });

  it('reads the effective Codex MCP URL from get --json', async () => {
    mockExec((_c, args) => {
      if (args.includes('get')) {
        return {
          status: 0,
          stdout: JSON.stringify({
            name: 'workos',
            transport: { type: 'streamable_http', url: 'https://mcp.workos.com/mcp' },
          }),
        };
      }
      return { status: 0 };
    });

    expect(await codex().getConfiguredUrl()).toBe('https://mcp.workos.com/mcp');
  });

  it('returns null when Codex get output is unavailable or malformed', async () => {
    mockExec(() => ({ status: 0, stdout: 'not-json' }));
    expect(await codex().getConfiguredUrl()).toBeNull();
  });

  it('remove maps "No MCP server named" (exit 0) to not-installed', async () => {
    mockExec(() => ({ status: 0, stdout: "No MCP server named 'workos' found." }));
    expect((await codex().remove()).outcome).toBe('not-installed');
  });
});

describe('Cursor client', () => {
  const cursor = () => clientByKey('cursor');
  const val = `{ "url": "https://mcp.workos.com/mcp" }`;

  it('add creates the file when none exists', async () => {
    const res = await cursor().add();
    expect(res.outcome).toBe('installed');
    const written = JSON.parse(readFileSync(cursorConfigPath(), 'utf8'));
    expect(written.mcpServers.workos.url).toBe('https://mcp.workos.com/mcp');
  });

  it('add handles an empty file', async () => {
    writeCursorConfig('');
    expect((await cursor().add()).outcome).toBe('installed');
    const written = JSON.parse(readFileSync(cursorConfigPath(), 'utf8'));
    expect(written.mcpServers.workos.url).toBe('https://mcp.workos.com/mcp');
  });

  it('add preserves unrelated servers and comments', async () => {
    writeCursorConfig('{\n  // keep me\n  "mcpServers": {\n    "other": { "url": "https://other" }\n  }\n}');
    expect((await cursor().add()).outcome).toBe('installed');
    const raw = readFileSync(cursorConfigPath(), 'utf8');
    expect(raw).toContain('// keep me');
    expect(raw).toContain('"other"');
    expect(raw).toContain('https://mcp.workos.com/mcp');
  });

  it('add tolerates a trailing comma (valid JSONC, not malformed)', async () => {
    writeCursorConfig('{ "mcpServers": { "other": { "url": "https://other" } }, }');
    expect((await cursor().add()).outcome).toBe('installed');
  });

  it('add on a malformed file fails WITHOUT overwriting it', async () => {
    const malformed = '{ "mcpServers": ';
    writeCursorConfig(malformed);
    const res = await cursor().add();
    expect(res.outcome).toBe('failed');
    expect(res.error).toContain('fix it manually');
    expect(readFileSync(cursorConfigPath(), 'utf8')).toBe(malformed);
  });

  it('add overwrites an existing workos key with a different URL (idempotent converge)', async () => {
    writeCursorConfig('{ "mcpServers": { "workos": { "url": "https://old" } } }');
    expect((await cursor().add()).outcome).toBe('installed');
    const written = JSON.parse(readFileSync(cursorConfigPath(), 'utf8'));
    expect(written.mcpServers.workos.url).toBe('https://mcp.workos.com/mcp');
  });

  it('isInstalled reflects presence of the workos key', async () => {
    writeCursorConfig(`{ "mcpServers": { "workos": ${val} } }`);
    expect(await cursor().isInstalled()).toBe(true);
    writeCursorConfig('{ "mcpServers": { "other": { "url": "x" } } }');
    expect(await cursor().isInstalled()).toBe(false);
  });

  it('remove drops only the workos key, preserving others', async () => {
    writeCursorConfig('{ "mcpServers": { "workos": { "url": "https://w" }, "other": { "url": "https://o" } } }');
    expect((await cursor().remove()).outcome).toBe('removed');
    const written = JSON.parse(readFileSync(cursorConfigPath(), 'utf8'));
    expect(written.mcpServers.workos).toBeUndefined();
    expect(written.mcpServers.other.url).toBe('https://o');
  });

  it('remove is a no-op (not-installed) when the file is absent', async () => {
    expect((await cursor().remove()).outcome).toBe('not-installed');
  });

  it('remove is a no-op (not-installed) when the key is absent', async () => {
    writeCursorConfig('{ "mcpServers": { "other": { "url": "x" } } }');
    expect((await cursor().remove()).outcome).toBe('not-installed');
  });
});

describe('runMcpInstall / runMcpRemove (human mode)', () => {
  it('acts on all detected agents and prints the matrix', async () => {
    makeDir('.claude');
    makeDir('.codex');
    makeDir('.cursor');
    mockExec(() => ({ status: 0 }));
    await runMcpInstall();
    const joined = uiLogs.join('\n');
    expect(joined).toContain('Claude Code');
    expect(joined).toContain('Codex');
    expect(joined).toContain('Cursor');
    expect(joined).toContain('Codex: configured (user scope)');
    expect(joined).toContain('codex mcp login workos');
    expect(joined).toContain('https://workos.com/docs/mcp');
  });

  it('prints the no-agents message and exits 0 when none are detected', async () => {
    mockExec((_c, args) => (args[0] === '--version' ? { status: 1 } : { status: 0 }));
    const exit = await captureExit(() => runMcpInstall());
    expect(exit).toBeUndefined();
    expect(uiLogs.join('\n')).toContain('No supported coding agents detected');
  });

  it('exits 1 when any agent fails, after emitting the full matrix', async () => {
    makeDir('.claude');
    makeDir('.cursor');
    // Claude add fails hard; Cursor add succeeds. Matrix must include both.
    mockExec((_c, args) => {
      if (args.includes('add')) return { status: 1, stderr: 'kaboom' };
      return { status: 0 };
    });
    const exit = await captureExit(() => runMcpInstall());
    expect(exit?.exitCode).toBe(1);
    const joined = uiLogs.join('\n');
    expect(joined).toContain('Claude Code');
    expect(joined).toContain('Cursor');
  });

  it('narrows to --agent claude-code', async () => {
    makeDir('.claude');
    makeDir('.codex');
    makeDir('.cursor');
    setOutputMode('json');
    await runMcpInstall({ agent: ['claude-code'] });
    const output = JSON.parse(consoleOutput[0]);
    expect(output.data.agents).toHaveLength(1);
    expect(output.data.agents[0].agent).toBe('claude-code');
  });

  it('rejects an unknown --agent with a structured error and exit 1', async () => {
    const exit = await captureExit(() => runMcpInstall({ agent: ['bogus'] }));
    expect(exit?.exitCode).toBe(1);
    expect(consoleOutput.join('\n')).toContain('Unknown agent');
  });
});

describe('JSON output mode', () => {
  beforeEach(() => {
    setOutputMode('json');
  });

  it('runMcpInstall emits status ok with a per-agent matrix', async () => {
    makeDir('.claude');
    makeDir('.cursor');
    mockExec(() => ({ status: 0 }));
    await runMcpInstall();
    const output = JSON.parse(consoleOutput[0]);
    expect(output.status).toBe('ok');
    expect(output.data.agents.map((a: { agent: string }) => a.agent).sort()).toEqual(['claude-code', 'cursor']);
    expect(output.data.agents.every((a: { outcome: string }) => a.outcome === 'installed')).toBe(true);
  });

  it('runMcpInstall with zero agents emits an empty matrix and exits 0', async () => {
    mockExec((_c, args) => (args[0] === '--version' ? { status: 1 } : { status: 0 }));
    const exit = await captureExit(() => runMcpInstall());
    expect(exit).toBeUndefined();
    const output = JSON.parse(consoleOutput[0]);
    expect(output.status).toBe('ok');
    expect(output.data.agents).toEqual([]);
  });

  it('runMcpInstall still emits the full matrix before exiting 1 on failure', async () => {
    makeDir('.claude');
    makeDir('.cursor');
    mockExec((_c, args) =>
      args.includes('add') && args.includes('--transport') ? { status: 1, stderr: 'bad' } : { status: 0 },
    );
    const exit = await captureExit(() => runMcpInstall());
    expect(exit?.exitCode).toBe(1);
    const output = JSON.parse(consoleOutput[0]);
    const claude = output.data.agents.find((a: { agent: string }) => a.agent === 'claude-code');
    const cursor = output.data.agents.find((a: { agent: string }) => a.agent === 'cursor');
    expect(claude.outcome).toBe('failed');
    expect(cursor.outcome).toBe('installed');
  });

  it('runMcpRemove emits status ok with outcomes', async () => {
    makeDir('.cursor');
    writeCursorConfig('{ "mcpServers": { "workos": { "url": "https://w" } } }');
    await runMcpRemove({ agent: ['cursor'] });
    const output = JSON.parse(consoleOutput[0]);
    expect(output.status).toBe('ok');
    expect(output.data.agents[0].outcome).toBe('removed');
  });

  it('runMcpStatus distinguishes configured state while retaining the legacy installed flag', async () => {
    makeDir('.cursor');
    writeCursorConfig('{ "mcpServers": { "workos": { "url": "https://w" } } }');
    mockExec((_c, args) => (args[0] === '--version' ? { status: 1 } : { status: 0 }));
    await runMcpStatus();
    const output = JSON.parse(consoleOutput[0]);
    expect(output.data.agents).toHaveLength(3);
    const cursor = output.data.agents.find((a: { agent: string }) => a.agent === 'cursor');
    expect(cursor).toMatchObject({
      agent: 'cursor',
      displayName: 'Cursor',
      available: true,
      configured: true,
      installed: true,
    });
    const claude = output.data.agents.find((a: { agent: string }) => a.agent === 'claude-code');
    expect(claude).toMatchObject({ available: false, configured: false, installed: false });
  });
});
