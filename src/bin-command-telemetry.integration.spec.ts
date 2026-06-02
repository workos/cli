import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Integration test for the command-telemetry lifecycle in bin.ts.
 *
 * bin.ts runs runCli() at import and exposes no seams, so the only honest way
 * to test the wiring is to drive the real CLI as a subprocess. We run a KNOWN
 * command with a missing required argument and assert that the resulting
 * `command` telemetry event is recorded (attributed to the real command, with
 * a validation_error reason) rather than being silently dropped.
 *
 * Regression guard for the gap where yargs runs its demand/strict validation
 * before dispatching middleware: a validation failure short-circuited before
 * the command-name middleware ran, leaving the name as 'root' (which is in
 * SKIP_TELEMETRY_COMMANDS), so we lost telemetry for every misused command.
 *
 * We observe the emitted event via the store-forward pending file rather than
 * stdout: pointing the CLI at an unroutable telemetry URL makes the flush fail,
 * so the queued events are persisted to <TMPDIR>/workos-cli-telemetry/ on exit.
 * That captures the real event payload, independent of debug-log formatting.
 */
const binPath = fileURLToPath(new URL('./bin.ts', import.meta.url));
const forceInsecureStorageImport = new URL('./test/force-insecure-storage.ts', import.meta.url).href;
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let sandboxTmp: string;

beforeEach(() => {
  sandboxTmp = mkdtempSync(join(tmpdir(), 'wos-cli-telem-it-'));
});

afterEach(() => {
  rmSync(sandboxTmp, { recursive: true, force: true });
});

/** Seed ~/.workos/preferences.json inside the sandboxed HOME before a run. */
function seedPreferences(prefs: unknown): void {
  const workosDir = join(sandboxTmp, '.workos');
  mkdirSync(workosDir, { recursive: true });
  writeFileSync(join(workosDir, 'preferences.json'), JSON.stringify(prefs), 'utf-8');
}

function runCli(args: string[], envOverrides: NodeJS.ProcessEnv = {}) {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: sandboxTmp,
    USERPROFILE: sandboxTmp,
    TMPDIR: sandboxTmp,
    TMP: sandboxTmp,
    TEMP: sandboxTmp,
    // Keep prompts/update checks disabled without inheriting host agent/CI env.
    WORKOS_MODE: 'agent',
    // Force telemetry on so a host WORKOS_TELEMETRY=false can't make the test
    // silently produce no event and fail. Tests that exercise env precedence
    // override this explicitly via envOverrides.
    WORKOS_TELEMETRY: 'true',
    // Unroutable URL: the flush fails, so the queued events are persisted to
    // the pending file on exit where we can inspect the real payload.
    WORKOS_TELEMETRY_URL: 'http://127.0.0.1:59999/cli',
    WORKOS_API_KEY: 'sk_dummy_for_test',
    ...envOverrides,
  };

  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--import', forceInsecureStorageImport, binPath, ...args],
    {
      cwd: repoRoot,
      encoding: 'utf-8',
      env,
    },
  );

  const events: Array<{ type: string; attributes?: Record<string, unknown> }> = [];
  const pendingDir = join(sandboxTmp, 'workos-cli-telemetry');
  let entries: ReturnType<typeof readdirSync> = [];
  try {
    entries = readdirSync(pendingDir, { withFileTypes: true });
  } catch {
    // No pending dir => no events were ever queued (e.g. opted out).
  }
  for (const file of entries) {
    if (file.isFile() && file.name.startsWith('pending-') && file.name.endsWith('.json')) {
      events.push(...JSON.parse(readFileSync(join(pendingDir, file.name), 'utf-8')));
    }
  }
  return { result, events };
}

describe('command telemetry lifecycle', () => {
  it('emits a command event for a known command that fails validation', () => {
    // `organization create` requires a positional `name`; omitting it is a
    // validation error on a real, known command.
    const { result, events } = runCli(['organization', 'create']);

    expect(`${result.stdout}\n${result.stderr}`).toContain('Not enough non-option arguments');

    const command = events.find((e) => e.type === 'command');
    expect(command).toBeDefined();
    // Validation fails before middleware runs, so only the top-level command is
    // recovered (subcommand precision is intentionally dropped to avoid leaking
    // positional values). The key regression: it's attributed, not skipped as 'root'.
    expect(command?.attributes?.['command.name']).toBe('organization');
    expect(command?.attributes?.['termination.reason']).toBe('validation_error');
    expect(command?.attributes?.['command.success']).toBe(false);
  }, 20_000);

  it('records a crash event with a redacted stack when a command crashes unexpectedly', () => {
    // `debug simulate --crash` throws a plain Error (not CliExit), which the
    // lifecycle must classify as a crash (not validation_error).
    const { result, events } = runCli(['debug', 'simulate', '--crash']);
    expect(result.status).not.toBe(0);

    // A crash must not be a silent exit-1: the error surfaces on stderr.
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/Simulated crash/);

    const crash = events.find((e) => e.type === 'crash');
    expect(crash).toBeDefined();
    expect(crash?.attributes?.['crash.error_type']).toBe('Error');
    expect(crash?.attributes?.['crash.command']).toBe('debug.simulate');

    // The accompanying command event is classified as a crash, not a validation error.
    const command = events.find((e) => e.type === 'command');
    expect(command?.attributes?.['termination.reason']).toBe('crash');

    // Stack must be redacted: no absolute home path, no full repo path.
    const stack = String(crash?.attributes?.['crash.stack'] ?? '');
    expect(stack).toContain('Simulated crash');
    expect(stack).not.toMatch(/\/Users\/[^/]+\//); // POSIX home dir collapsed to ~
    expect(stack).not.toContain(repoRoot);
  }, 20_000);

  it('emits zero events when the saved preference is opted out', () => {
    seedPreferences({ telemetry: { optedOut: true } });
    // Clear the forced WORKOS_TELEMETRY so the saved preference is honored
    // (an empty string is not the tri-state 'true'/'false', so it falls through).
    const { events } = runCli(['organization', 'create'], { WORKOS_TELEMETRY: '' });
    expect(events).toHaveLength(0);
  }, 20_000);

  it('env WORKOS_TELEMETRY=true overrides an opted-out preference (event IS emitted)', () => {
    seedPreferences({ telemetry: { optedOut: true } });
    const { events } = runCli(['organization', 'create'], { WORKOS_TELEMETRY: 'true' });
    expect(events.find((e) => e.type === 'command')).toBeDefined();
  }, 20_000);

  it('env WORKOS_TELEMETRY=false suppresses events even when not opted out', () => {
    const { events } = runCli(['organization', 'create'], { WORKOS_TELEMETRY: 'false' });
    expect(events).toHaveLength(0);
  }, 20_000);
});
