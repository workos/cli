import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mocks = vi.hoisted(() => ({
  createEmulator: vi.fn(),
  close: vi.fn(),
}));

vi.mock('@workos/emulate', () => ({
  createEmulator: mocks.createEmulator,
}));

const { runEmulate } = await import('./emulate.js');

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const;

describe('runEmulate', () => {
  let originalListeners: Record<(typeof SIGNALS)[number], ReturnType<typeof process.listeners>>;
  let cwd: string;
  let tempDir: string;

  beforeEach(() => {
    originalListeners = {
      SIGINT: process.listeners('SIGINT'),
      SIGTERM: process.listeners('SIGTERM'),
      SIGBREAK: process.listeners('SIGBREAK'),
    };
    cwd = process.cwd();
    tempDir = mkdtempSync(join(tmpdir(), 'workos-emulate-'));
    process.chdir(tempDir);

    mocks.close.mockResolvedValue(undefined);
    mocks.createEmulator.mockResolvedValue({
      url: 'http://localhost:4100',
      port: 4100,
      apiKey: 'sk_test_default',
      close: mocks.close,
    });

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    mocks.createEmulator.mockReset();
    mocks.close.mockReset();

    for (const signal of SIGNALS) {
      process.removeAllListeners(signal);
      for (const listener of originalListeners[signal]) {
        process.on(signal, listener);
      }
    }
  });

  it('starts the external emulator package on the requested port', async () => {
    await runEmulate({ port: 0, interactive: false });

    expect(mocks.createEmulator).toHaveBeenCalledWith({
      port: 0,
      seed: undefined,
      interactiveAuth: false,
    });
  });

  it('prints startup details as JSON when requested', async () => {
    await runEmulate({ port: 4100, json: true });

    expect(console.log).toHaveBeenCalledWith(
      JSON.stringify({
        url: 'http://localhost:4100',
        port: 4100,
        apiKey: 'sk_test_default',
        health: 'http://localhost:4100/health',
      }),
    );
  });

  it('passes the interactive flag through to the emulator package', async () => {
    await runEmulate({ port: 4100, interactive: true });

    expect(mocks.createEmulator).toHaveBeenCalledWith({
      port: 4100,
      seed: undefined,
      interactiveAuth: true,
    });
  });

  it('loads an explicit JSON seed file', async () => {
    const seedPath = join(tempDir, 'seed.json');
    writeFileSync(seedPath, JSON.stringify({ users: [{ email: 'test@example.com' }] }));

    await runEmulate({ port: 4100, seed: seedPath });

    expect(mocks.createEmulator).toHaveBeenCalledWith({
      port: 4100,
      seed: { users: [{ email: 'test@example.com' }] },
      interactiveAuth: undefined,
    });
  });

  it('auto-detects workos-emulate config files', async () => {
    writeFileSync('workos-emulate.config.yaml', 'users:\n  - email: yaml@example.com\n');

    await runEmulate({ port: 4100 });

    expect(mocks.createEmulator).toHaveBeenCalledWith({
      port: 4100,
      seed: { users: [{ email: 'yaml@example.com' }] },
      interactiveAuth: undefined,
    });
  });
});
