import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Integration test for the deprecated --commit/--no-commit backward-compat shim.
 *
 * The installer never commits changes, but scripts written against older
 * versions still pass --no-commit (or --commit). These flags must be accepted
 * as no-ops: strict parsing must not reject them, and a deprecation warning
 * must go to stderr (never stdout, so JSON streams stay clean).
 *
 * bin.ts runs runCli() at import and exposes no seams, so the only honest way
 * to prove the shim is to drive the real CLI as a subprocess. With no
 * credentials and an unroutable API base, a successful parse falls through to
 * the auth-required exit (4); a strict-parser rejection exits 1 with
 * "Unknown argument" instead.
 */
const binPath = fileURLToPath(new URL('./bin.ts', import.meta.url));
const forceInsecureStorageImport = fileURLToPath(new URL('./test/force-insecure-storage.ts', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let sandboxTmp: string;

beforeEach(() => {
  sandboxTmp = mkdtempSync(join(tmpdir(), 'wos-cli-deprecated-flags-it-'));
});

afterEach(() => {
  rmSync(sandboxTmp, { recursive: true, force: true });
});

function runCli(args: string[]) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: sandboxTmp,
    USERPROFILE: sandboxTmp,
    TMPDIR: sandboxTmp,
    TMP: sandboxTmp,
    TEMP: sandboxTmp,
    WORKOS_MODE: 'agent',
    // Keep machine streams clean: no telemetry, no update check network calls.
    WORKOS_TELEMETRY: 'false',
    // Unroutable API base so provisioning fails fast and falls back to auth.
    WORKOS_API_URL: 'http://127.0.0.1:59999',
  };

  return spawnSync('bun', ['--preload', forceInsecureStorageImport, binPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env,
  });
}

describe('deprecated install flags (backward-compat shims)', () => {
  it('--no-commit is accepted as a no-op and warns on stderr', () => {
    const result = runCli(['install', '--no-commit']);

    // Past strict parsing: auth-required (4), not a validation error (1).
    expect(result.status).toBe(4);
    expect(result.stderr).not.toContain('Unknown argument');
    expect(result.stderr).toContain('Deprecated flag: --no-commit');
    // JSON/machine stdout stays clean.
    expect(result.stdout).not.toContain('Deprecated flag');
  }, 30_000);

  it('--commit is accepted as a no-op and warns on stderr', () => {
    const result = runCli(['install', '--commit']);

    expect(result.status).toBe(4);
    expect(result.stderr).not.toContain('Unknown argument');
    expect(result.stderr).toContain('Deprecated flag: --commit');
    expect(result.stdout).not.toContain('Deprecated flag');
  }, 30_000);

  it('omitting the flag emits no deprecation warning', () => {
    const result = runCli(['install']);

    expect(result.status).toBe(4);
    expect(result.stderr).not.toContain('Deprecated flag');
  }, 30_000);
});
