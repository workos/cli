import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------- Mocks ----------

const mockSdk = {
  vault: {
    readObjectByName: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const mockResolveApiKey = vi.fn(() => 'sk_test_resolved');
const mockResolveApiBaseUrl = vi.fn(() => 'https://api.workos.com');
vi.mock('../lib/api-key.js', () => ({
  resolveApiKey: (...args: unknown[]) => mockResolveApiKey(...(args as [])),
  resolveApiBaseUrl: (...args: unknown[]) => mockResolveApiBaseUrl(...(args as [])),
}));

const mockConfig = {
  environments: {} as Record<string, { apiKey?: string }>,
};
vi.mock('../lib/config-store.js', () => ({
  getConfig: () => mockConfig,
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

// Replace exitWithError with a throwing mock so we can assert on the structured error.
// Keep the other exports intact (isJsonMode, outputJson, outputSuccess, outputError).
let outputModeState: 'human' | 'json' = 'human';
const exitErrors: Array<{ code: string; message: string }> = [];
const successCalls: Array<{ message: string; data?: unknown }> = [];

vi.mock('../utils/output.js', () => ({
  isJsonMode: () => outputModeState === 'json',
  setOutputMode: (mode: 'human' | 'json') => {
    outputModeState = mode;
  },
  getOutputMode: () => outputModeState,
  outputJson: vi.fn((data: unknown) => console.log(JSON.stringify(data))),
  outputSuccess: vi.fn((message: string, data?: object) => {
    successCalls.push({ message, data });
    if (outputModeState === 'json') {
      const out: Record<string, unknown> = { status: 'ok', message };
      if (data) out.data = data;
      console.log(JSON.stringify(out));
    } else {
      console.log(message);
      if (data) console.log(JSON.stringify(data, null, 2));
    }
  }),
  outputError: vi.fn((err: { code: string; message: string }) => {
    console.error(err.message);
  }),
  exitWithError: vi.fn((err: { code: string; message: string }) => {
    exitErrors.push({ code: err.code, message: err.message });
    console.error(err.message);
    throw new Error(`__EXIT__:${err.code}`);
  }),
}));

// ---------- Module under test ----------

const { spawn } = await import('node:child_process');
const mockSpawn = vi.mocked(spawn);

const { parseSecretMappings, fetchSecrets, runVaultRun } = await import('./vault-run.js');

// ---------- Helpers ----------

/**
 * Mock child process. Does NOT auto-emit 'exit' — the test triggers it after
 * spawn has been called so the child.on('exit') handler is registered first.
 *
 * `fireExit` swallows the throw from the mocked `process.exit` so the test
 * call site doesn't see it escape synchronously.
 */
function createMockChild() {
  const proc = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    killed: boolean;
    fireExit: (code: number) => void;
  };
  proc.kill = vi.fn();
  proc.killed = false;
  proc.fireExit = (code: number) => {
    try {
      proc.emit('exit', code, null);
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('__PROCESS_EXIT__:')) return;
      throw err;
    }
  };
  return proc;
}

/**
 * Some code paths end with `process.exit(code)`. We install a per-test spy
 * that records the code and resolves a deferred promise so the test can await
 * the synchronous exit without the spy's throw escaping unhandled.
 */
function withSpawnExitCapture(): {
  exitSpy: ReturnType<typeof vi.spyOn>;
  exited: Promise<number>;
  restore: () => void;
} {
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    resolveExit(code ?? 0);
    // Throw so callers don't continue past process.exit — same shape as real.
    // The throw is caught by the synchronous `swallow`/awaited promise.
    throw new Error(`__PROCESS_EXIT__:${code ?? 0}`);
  }) as never);
  return {
    exitSpy,
    exited,
    restore: () => exitSpy.mockRestore(),
  };
}

async function swallow(promise: Promise<unknown> | unknown): Promise<void> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error && (err.message.startsWith('__EXIT__:') || err.message.startsWith('__PROCESS_EXIT__:'))) {
      return;
    }
    throw err;
  }
}

// ---------- Tests ----------

describe('vault-run', () => {
  let consoleLog: string[];
  let consoleErr: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLog = [];
    consoleErr = [];
    exitErrors.length = 0;
    successCalls.length = 0;
    outputModeState = 'human';
    mockConfig.environments = {};
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleLog.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErr.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    outputModeState = 'human';
  });

  describe('parseSecretMappings', () => {
    it('parses a single valid mapping', () => {
      const result = parseSecretMappings(['DB_URL=my-db-secret']);
      expect(result).toEqual([{ envVar: 'DB_URL', vaultName: 'my-db-secret' }]);
    });

    it('parses multiple valid mappings', () => {
      const result = parseSecretMappings(['DB_URL=db', 'API_KEY=api-key-name']);
      expect(result).toEqual([
        { envVar: 'DB_URL', vaultName: 'db' },
        { envVar: 'API_KEY', vaultName: 'api-key-name' },
      ]);
    });

    it('preserves vault names that contain unusual characters (but not =)', () => {
      const result = parseSecretMappings(['TOKEN=my/scoped-name.v2']);
      expect(result).toEqual([{ envVar: 'TOKEN', vaultName: 'my/scoped-name.v2' }]);
    });

    it('exits on missing = separator', () => {
      expect(() => parseSecretMappings(['DB_URL'])).toThrow(/__EXIT__/);
      expect(exitErrors[0]).toMatchObject({ code: 'invalid_secret_format' });
      expect(exitErrors[0].message).toMatch(/Invalid secret mapping/);
    });

    it('exits on empty env var name', () => {
      expect(() => parseSecretMappings(['=value'])).toThrow(/__EXIT__/);
      expect(exitErrors[0]).toMatchObject({ code: 'invalid_secret_format' });
    });

    it('exits on empty vault name', () => {
      expect(() => parseSecretMappings(['DB_URL='])).toThrow(/__EXIT__/);
      expect(exitErrors[0]).toMatchObject({ code: 'invalid_secret_format' });
    });

    it('exits on duplicate env var names', () => {
      expect(() => parseSecretMappings(['DB_URL=a', 'DB_URL=b'])).toThrow(/__EXIT__/);
      expect(exitErrors[0]).toMatchObject({ code: 'duplicate_env_var' });
      expect(exitErrors[0].message).toMatch(/'DB_URL'/);
    });

    it('exits when no secrets provided', () => {
      expect(() => parseSecretMappings([])).toThrow(/__EXIT__/);
      expect(exitErrors[0]).toMatchObject({ code: 'missing_secrets' });
    });
  });

  describe('fetchSecrets', () => {
    it('fetches a single secret', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({
        id: 'obj_1',
        name: 'db',
        value: 'secret-db-value',
        metadata: {},
      });
      const result = await fetchSecrets([{ envVar: 'DB_URL', vaultName: 'db' }], 'sk_test');
      expect(result.get('DB_URL')).toBe('secret-db-value');
      expect(mockSdk.vault.readObjectByName).toHaveBeenCalledWith('db');
    });

    it('fetches multiple secrets sequentially', async () => {
      mockSdk.vault.readObjectByName
        .mockResolvedValueOnce({ id: 'a', name: 'db', value: 'val-a', metadata: {} })
        .mockResolvedValueOnce({ id: 'b', name: 'api', value: 'val-b', metadata: {} });

      const result = await fetchSecrets(
        [
          { envVar: 'DB_URL', vaultName: 'db' },
          { envVar: 'API_KEY', vaultName: 'api' },
        ],
        'sk_test',
      );
      expect(result.get('DB_URL')).toBe('val-a');
      expect(result.get('API_KEY')).toBe('val-b');
      expect(mockSdk.vault.readObjectByName).toHaveBeenCalledTimes(2);
    });

    it('exits when vault object lookup fails, naming the object but not the value', async () => {
      mockSdk.vault.readObjectByName
        .mockResolvedValueOnce({ id: 'a', name: 'db', value: 'leaky-value', metadata: {} })
        .mockRejectedValueOnce(Object.assign(new Error('Not Found'), { status: 404, requestID: 'req_1' }));

      await expect(
        fetchSecrets(
          [
            { envVar: 'DB_URL', vaultName: 'db' },
            { envVar: 'API_KEY', vaultName: 'missing-name' },
          ],
          'sk_test',
        ),
      ).rejects.toThrow(/__EXIT__/);

      const stderr = consoleErr.join('\n');
      expect(stderr).toMatch(/missing-name/);
      expect(stderr).not.toMatch(/leaky-value/);
    });

    it('exits when readObjectByName returns no value', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({
        id: 'obj_1',
        name: 'db',
        metadata: {},
      });
      await expect(fetchSecrets([{ envVar: 'DB_URL', vaultName: 'db' }], 'sk_test')).rejects.toThrow(/__EXIT__/);
      expect(exitErrors[0]).toMatchObject({ code: 'vault_value_missing' });
      expect(exitErrors[0].message).toMatch(/db/);
    });
  });

  describe('runVaultRun — dry run', () => {
    it('prints metadata table in human mode without spawning', async () => {
      await runVaultRun({
        secrets: ['DB_URL=db', 'API_KEY=api-key'],
        command: [],
        dryRun: true,
      });

      expect(mockSpawn).not.toHaveBeenCalled();
      expect(mockSdk.vault.readObjectByName).not.toHaveBeenCalled();

      const stdout = consoleLog.join('\n');
      expect(stdout).toMatch(/DB_URL/);
      expect(stdout).toMatch(/db/);
      expect(stdout).toMatch(/API_KEY/);
      expect(stdout).toMatch(/api-key/);
    });

    it('emits JSON metadata in JSON mode without spawning', async () => {
      outputModeState = 'json';
      await runVaultRun({
        secrets: ['DB_URL=db'],
        command: [],
        dryRun: true,
        env: 'production',
        org: 'org_123',
      });

      expect(mockSpawn).not.toHaveBeenCalled();
      const parsed = JSON.parse(consoleLog[0]);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.env).toBe('production');
      expect(parsed.org).toBe('org_123');
      expect(parsed.mappings).toEqual([{ envVar: 'DB_URL', vaultName: 'db' }]);
    });
  });

  describe('runVaultRun — execution', () => {
    it('spawns child with injected env vars and resolves the active env API key', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({
        id: 'a',
        name: 'db',
        value: 'real-db-value',
        metadata: {},
      });
      const child = createMockChild();
      mockSpawn.mockReturnValueOnce(child as never);
      const { exited, restore } = withSpawnExitCapture();

      await swallow(
        runVaultRun({
          secrets: ['DB_URL=db'],
          command: ['printenv', 'DB_URL'],
        }),
      );
      // runVaultRun has registered the spawn handler — now fire exit.
      child.fireExit(0);
      const code = await exited;

      expect(code).toBe(0);
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [cmd, args, opts] = mockSpawn.mock.calls[0];
      expect(cmd).toBe('printenv');
      expect(args).toEqual(['DB_URL']);
      const spawnOpts = opts as { env: NodeJS.ProcessEnv; stdio: string };
      expect(spawnOpts.stdio).toBe('inherit');
      expect(spawnOpts.env.DB_URL).toBe('real-db-value');
      restore();
    });

    it('forwards child non-zero exit code', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({
        id: 'a',
        name: 'db',
        value: 'val',
        metadata: {},
      });
      const child = createMockChild();
      mockSpawn.mockReturnValueOnce(child as never);
      const { exited, restore } = withSpawnExitCapture();

      await swallow(
        runVaultRun({
          secrets: ['DB_URL=db'],
          command: ['some-tool'],
        }),
      );
      child.fireExit(42);
      const code = await exited;

      expect(code).toBe(42);
      restore();
    });

    it('exits with usage error when no command is supplied', async () => {
      await expect(
        runVaultRun({
          secrets: ['DB_URL=db'],
          command: [],
        }),
      ).rejects.toThrow(/__EXIT__/);

      expect(exitErrors[0]).toMatchObject({ code: 'missing_command' });
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('looks up the API key for a named environment via --env', async () => {
      mockConfig.environments['staging'] = { apiKey: 'sk_staging' };
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({
        id: 'a',
        name: 'db',
        value: 'val',
        metadata: {},
      });
      const child = createMockChild();
      mockSpawn.mockReturnValueOnce(child as never);
      const { exited, restore } = withSpawnExitCapture();

      await swallow(
        runVaultRun({
          secrets: ['DB_URL=db'],
          command: ['echo'],
          env: 'staging',
        }),
      );
      child.fireExit(0);
      await exited;

      // resolveApiKey from api-key.js mock should not be called when --env is set.
      expect(mockResolveApiKey).not.toHaveBeenCalled();
      restore();
    });

    it('exits when --env names an unknown environment', async () => {
      await expect(
        runVaultRun({
          secrets: ['DB_URL=db'],
          command: ['echo'],
          env: 'no-such-env',
        }),
      ).rejects.toThrow(/__EXIT__/);

      expect(exitErrors[0]).toMatchObject({ code: 'env_not_found' });
      expect(exitErrors[0].message).toMatch(/no-such-env/);
      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });

  describe('JSON mode metadata on execution', () => {
    beforeEach(() => {
      outputModeState = 'json';
    });
    afterEach(() => {
      outputModeState = 'human';
    });

    it('emits an ok status with the injection metadata (never the value)', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({
        id: 'a',
        name: 'db',
        value: 'top-secret-db',
        metadata: {},
      });
      const child = createMockChild();
      mockSpawn.mockReturnValueOnce(child as never);
      const { exited, restore } = withSpawnExitCapture();

      await swallow(
        runVaultRun({
          secrets: ['DB_URL=db'],
          command: ['true'],
        }),
      );
      child.fireExit(0);
      await exited;

      const meta = successCalls[0];
      expect(meta).toBeDefined();
      expect((meta.data as { injected: unknown }).injected).toEqual([{ envVar: 'DB_URL', vaultName: 'db' }]);
      const serialized = JSON.stringify(meta);
      expect(serialized).not.toMatch(/top-secret-db/);
      restore();
    });
  });

  describe('security boundary', () => {
    it('never prints a secret value to stdout or stderr across success and failure paths', async () => {
      const SECRET = 'super-secret-value-12345';

      // Path 1: successful fetch + spawn
      mockSdk.vault.readObjectByName.mockResolvedValueOnce({ id: 'a', name: 'db', value: SECRET, metadata: {} });
      const child = createMockChild();
      mockSpawn.mockReturnValueOnce(child as never);
      const { exited, restore } = withSpawnExitCapture();
      await swallow(runVaultRun({ secrets: ['DB_URL=db'], command: ['true'] }));
      child.fireExit(0);
      await exited;
      restore();

      // Path 2: fetch failure
      mockSdk.vault.readObjectByName.mockRejectedValueOnce(
        Object.assign(new Error('boom'), { status: 500, requestID: 'r' }),
      );
      await swallow(runVaultRun({ secrets: ['DB_URL=db'], command: ['true'] }));

      const allOutput = [...consoleLog, ...consoleErr].join('\n');
      expect(allOutput).not.toMatch(new RegExp(SECRET));
    });
  });
});
