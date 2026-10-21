import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Integration test for the fixed `$0` default-command output.
 *
 * bin.ts runs runCli() at import and exposes no seams, so the only honest way
 * to prove the friction fix is to drive the real CLI as a subprocess and read
 * its streams. Pre-fix, a bare non-TTY invocation ran `yargs(rawArgs).showHelp()`
 * on a FRESH yargs instance (zero commands registered), emitting a degenerate
 * two-line `--help`/`--version` block to stderr and leaving stdout empty — a
 * piped agent/CI consumer got nothing and never discovered `install`.
 *
 * We use a LOCAL spawn helper (not the shared one in
 * bin-command-telemetry.integration.spec.ts) because that one hardcodes
 * WORKOS_MODE=agent, which the CI and human-force-TTY cases must omit. The env
 * is built clean (spawnSync replaces, not merges) so host agent/CI markers are
 * absent unless a case adds them.
 */
const binPath = fileURLToPath(new URL('./bin.ts', import.meta.url));
const forceInsecureStorageImport = fileURLToPath(new URL('./test/force-insecure-storage.ts', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let sandboxTmp: string;

beforeEach(() => {
  sandboxTmp = mkdtempSync(join(tmpdir(), 'wos-cli-default-it-'));
});

afterEach(() => {
  rmSync(sandboxTmp, { recursive: true, force: true });
});

function runCli(args: string[], envOverrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: sandboxTmp,
    USERPROFILE: sandboxTmp,
    TMPDIR: sandboxTmp,
    TMP: sandboxTmp,
    TEMP: sandboxTmp,
    // Keep machine streams clean: no telemetry, no update check network calls.
    WORKOS_TELEMETRY: 'false',
    // Unroutable API base (defense-in-depth; the $0 path never hits the network).
    WORKOS_API_URL: 'http://127.0.0.1:59999',
    // Per-case env last. Agent/CI markers are absent unless a case adds one.
    ...envOverrides,
  };

  return spawnSync('bun', ['--preload', forceInsecureStorageImport, binPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env,
  });
}

describe('bin $0 default command (non-TTY)', () => {
  it('agent mode emits the full machine-readable command tree on stdout', () => {
    const result = runCli([], { WORKOS_MODE: 'agent' });

    expect(result.status).toBe(0);

    const tree = JSON.parse(result.stdout.trim());
    expect(tree.name).toBe('workos');
    expect(tree.version).toBeTruthy();

    const names = tree.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(['install', 'auth login', 'organization', 'doctor']));
    // The installer must be discoverable — this is the friction being fixed.
    expect(tree.commands.some((c: { name: string }) => c.name === 'install')).toBe(true);

    // Regression guard: never emit the degenerate fresh-yargs help block.
    expect(result.stderr).not.toContain('Show version number');
  }, 20_000);

  it('CI mode (CI=1, no WORKOS_MODE) emits the command tree on stdout', () => {
    const result = runCli([], { CI: '1' });

    expect(result.status).toBe(0);

    const tree = JSON.parse(result.stdout.trim());
    expect(tree.name).toBe('workos');
    expect(tree.version).toBeTruthy();

    const names = tree.commands.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(['install', 'auth login', 'organization', 'doctor']));
    expect(result.stderr).not.toContain('Show version number');
  }, 20_000);

  it('human non-TTY edge (WORKOS_FORCE_TTY=1) shows the configured help, not JSON', () => {
    // WORKOS_MODE omitted entirely (never set to '' — that throws InvalidInteractionModeError).
    const result = runCli([], { WORKOS_FORCE_TTY: '1' });

    expect(result.status).toBe(0);

    const combined = `${result.stdout}\n${result.stderr}`;
    // parser.showHelp() (not the fresh-yargs block) lists the full command set.
    expect(combined).toContain('workos install');
    expect(combined).toContain('[aliases: integrate]');
    expect(combined).toMatch(/organization/);
    expect(combined).toMatch(/auth/);
  }, 20_000);

  it('--help --json still returns the command tree (regression for the intercept)', () => {
    const result = runCli(['--help', '--json'], { WORKOS_MODE: 'agent' });

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout.trim());
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.length).toBeGreaterThan(0);
  }, 20_000);
});
