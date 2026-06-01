import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

let sandboxTmp: string;

beforeEach(() => {
  sandboxTmp = mkdtempSync(join(tmpdir(), 'wos-cli-telem-it-'));
});

afterEach(() => {
  rmSync(sandboxTmp, { recursive: true, force: true });
});

function runCli(args: string[]) {
  const result = spawnSync('node', ['--import', 'tsx', binPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf-8',
    env: {
      ...process.env,
      // Isolate the child from the developer's real home: ~/.workos (device-id,
      // credentials) and store-forward output all resolve under the sandbox.
      // (The keyring mock and temp-HOME isolation from Vitest do not cross into
      // a spawned process, so we isolate HOME explicitly here.)
      HOME: sandboxTmp,
      TMPDIR: sandboxTmp, // PENDING_DIR = <tmpdir>/workos-cli-telemetry
      // Force telemetry on so an inherited WORKOS_TELEMETRY=false can't make the
      // test silently produce no event and fail.
      WORKOS_TELEMETRY: 'true',
      WORKOS_FORCE_TTY: '1',
      // Unroutable URL: the flush fails, so the queued events are persisted to
      // the pending file on exit where we can inspect the real payload.
      WORKOS_TELEMETRY_URL: 'http://127.0.0.1:59999/cli',
      WORKOS_API_KEY: 'sk_dummy_for_test',
    },
  });

  const events: Array<{ type: string; attributes?: Record<string, unknown> }> = [];
  const pendingDir = join(sandboxTmp, 'workos-cli-telemetry');
  for (const file of readdirSync(pendingDir, { withFileTypes: true })) {
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
});
