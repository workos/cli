import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
}));

// Mock the UI facade
vi.mock('../utils/ui.js', () => ({
  default: {
    log: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      step: vi.fn(),
      warn: vi.fn(),
    },
    text: vi.fn(),
    select: vi.fn(),
    password: vi.fn(),
    isCancel: vi.fn(() => false),
  },
}));

// Partial-mock the unclaimed-env API so we control provisioning outcomes but
// keep the real UnclaimedEnvApiError class for instanceof checks.
vi.mock('../lib/unclaimed-env-api.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/unclaimed-env-api.js')>();
  return { ...actual, provisionUnclaimedEnvironment: vi.fn() };
});

// Guard: runEnvProvision must NEVER write project .env files.
vi.mock('../lib/env-writer.js', () => ({ writeCredentialsEnv: vi.fn() }));

// Best-effort dashboard environment resolution — full behavior is covered in
// environment-target.spec.ts; here we only assert the add/switch wiring.
const mockTryResolveProfileEnvironmentId = vi.fn();
vi.mock('../lib/environment-target.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/environment-target.js')>();
  return {
    ...actual,
    tryResolveProfileEnvironmentId: (...args: unknown[]) => mockTryResolveProfileEnvironmentId(...args),
  };
});

let testDir: string;

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return {
    ...original,
    default: {
      ...original,
      homedir: () => testDir,
    },
    homedir: () => testDir,
  };
});

const { getConfig, saveConfig, setInsecureConfigStorage, clearConfig } = await import('../lib/config-store.js');
const { runEnvAdd, runEnvRemove, runEnvSwitch, runEnvList, runEnvProvision } = await import('./env.js');
const { provisionUnclaimedEnvironment, UnclaimedEnvApiError } = await import('../lib/unclaimed-env-api.js');
const { writeCredentialsEnv } = await import('../lib/env-writer.js');
const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');
const { CliExit } = await import('../utils/cli-exit.js');
const ui = (await import('../utils/ui.js')).default;

describe('env commands', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-cmd-test-'));
    setInsecureConfigStorage(true);
    resetInteractionModeForTests();
    delete process.env.WORKOS_API_URL;
    delete process.env.WORKOS_API_BASE_URL;
    vi.clearAllMocks();
    // Default: logged out — resolution defers to first dashboard-command use.
    mockTryResolveProfileEnvironmentId.mockResolvedValue(false);
  });

  afterEach(() => {
    clearConfig();
    resetInteractionModeForTests();
    setOutputMode('human');
    try {
      rmdirSync(join(testDir, '.workos'), { recursive: true });
    } catch {}
    try {
      rmdirSync(testDir);
    } catch {}
  });

  describe('runEnvAdd (non-interactive)', () => {
    it('adds an environment with provided args', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc123' });
      const config = getConfig();
      expect(config?.environments.prod).toBeDefined();
      expect(config?.environments.prod.apiKey).toBe('sk_live_abc123');
      expect(config?.environments.prod.type).toBe('production');
    });

    it('detects sandbox type from sk_test_ prefix', async () => {
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc123' });
      const config = getConfig();
      expect(config?.environments.sandbox.type).toBe('sandbox');
    });

    it('stores endpoint when provided', async () => {
      await runEnvAdd({ name: 'local', apiKey: 'sk_test_abc', endpoint: 'http://localhost:8001' });
      const config = getConfig();
      expect(config?.environments.local.endpoint).toBe('http://localhost:8001');
    });

    it('auto-sets active environment on first add', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('prod');
    });

    it('does not change active environment on subsequent adds', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('prod');
    });

    it('rejects invalid environment name', async () => {
      await expect(runEnvAdd({ name: 'INVALID NAME', apiKey: 'sk_test' })).rejects.toThrow(CliExit);
    });

    it('requires name and API key in agent mode without prompting', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      await expect(runEnvAdd({ name: 'prod' })).rejects.toThrow(CliExit);
      expect(ui.text).not.toHaveBeenCalled();
    });

    it('requires name and API key in CI mode without prompting', async () => {
      setInteractionMode({ mode: 'ci', source: 'env' });
      await expect(runEnvAdd({ name: 'prod' })).rejects.toThrow(CliExit);
      expect(ui.text).not.toHaveBeenCalled();
    });

    it('attempts best-effort dashboard environment resolution for the new profile', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      expect(mockTryResolveProfileEnvironmentId).toHaveBeenCalledWith('prod', { allowPicker: true });
    });

    it('never blocks profile creation when resolution defers (logged out)', async () => {
      mockTryResolveProfileEnvironmentId.mockResolvedValue(false);
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      // The profile write must land regardless of the resolution outcome.
      expect(getConfig()?.environments.prod).toBeDefined();
    });

    it('does not include placeholder commands in missing-args recovery metadata', async () => {
      setOutputMode('json');
      setInteractionMode({ mode: 'agent', source: 'env' });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(runEnvAdd({ name: 'prod' })).rejects.toThrow(CliExit);
        const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
        expect(parsed.error.recovery.hints[0]).toEqual({
          description: 'Provide environment name and API key as positional arguments.',
        });
      } finally {
        errorSpy.mockRestore();
      }
    });
  });

  describe('runEnvRemove', () => {
    it('removes an existing environment', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvRemove('prod');
      const config = getConfig();
      expect(config?.environments.prod).toBeUndefined();
    });

    it('switches active env when removing the active one', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
      // prod is active (first added)
      await runEnvRemove('prod');
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('sandbox');
    });

    it('errors for non-existent environment', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await expect(runEnvRemove('missing')).rejects.toThrow(CliExit);
    });

    it('errors when no environments configured', async () => {
      await expect(runEnvRemove('anything')).rejects.toThrow(CliExit);
    });

    it('warns that removal is local-only for an ordinary environment', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvRemove('prod');
      const warnMsg = vi
        .mocked(ui.log.warn)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');
      expect(warnMsg).toMatch(/local/i);
      // Ordinary env: must NOT claim the claim token was lost.
      expect(warnMsg).not.toMatch(/claim token/i);
    });

    it('warns that an unclaimed environment loses its claim token when removed', async () => {
      saveConfig({
        activeEnvironment: 'unclaimed',
        environments: {
          unclaimed: {
            name: 'unclaimed',
            type: 'unclaimed',
            apiKey: 'sk_test_abc',
            clientId: 'client_abc',
            claimToken: 'tok_abc',
          },
        },
      });
      await runEnvRemove('unclaimed');
      const warnMsg = vi
        .mocked(ui.log.warn)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');
      expect(warnMsg).toMatch(/local/i);
      expect(warnMsg).toMatch(/claim/i);
    });
  });

  describe('runEnvSwitch', () => {
    it('switches to a named environment', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
      await runEnvSwitch('sandbox');
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('sandbox');
    });

    it('errors for non-existent environment', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await expect(runEnvSwitch('missing')).rejects.toThrow(CliExit);
    });

    it('errors when no environments configured', async () => {
      await expect(runEnvSwitch('anything')).rejects.toThrow(CliExit);
    });

    it('attempts resolution when switching to a profile lacking an environmentId', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
      mockTryResolveProfileEnvironmentId.mockClear();
      await runEnvSwitch('sandbox');
      expect(mockTryResolveProfileEnvironmentId).toHaveBeenCalledWith('sandbox', { allowPicker: true });
    });

    it('skips resolution when the target profile already stores an environmentId', async () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: {
          prod: { name: 'prod', type: 'production', apiKey: 'sk_live_abc' },
          sandbox: {
            name: 'sandbox',
            type: 'sandbox',
            apiKey: 'sk_test_abc',
            environmentId: 'env_already',
          },
        },
      });
      await runEnvSwitch('sandbox');
      expect(mockTryResolveProfileEnvironmentId).not.toHaveBeenCalled();
    });

    it('warns when WORKOS_API_KEY env var is set', async () => {
      const original = process.env.WORKOS_API_KEY;
      process.env.WORKOS_API_KEY = 'sk_test_override';
      const stderrOutput: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        stderrOutput.push(args.map(String).join(' '));
      });
      try {
        await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
        await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
        await runEnvSwitch('sandbox');
        expect(stderrOutput.some((s) => s.includes('WORKOS_API_KEY'))).toBe(true);
      } finally {
        if (original === undefined) delete process.env.WORKOS_API_KEY;
        else process.env.WORKOS_API_KEY = original;
      }
    });

    it('does not warn when WORKOS_API_KEY env var is not set', async () => {
      const original = process.env.WORKOS_API_KEY;
      delete process.env.WORKOS_API_KEY;
      const stderrOutput: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        stderrOutput.push(args.map(String).join(' '));
      });
      try {
        await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
        await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
        await runEnvSwitch('sandbox');
        expect(stderrOutput).toHaveLength(0);
      } finally {
        if (original === undefined) delete process.env.WORKOS_API_KEY;
        else process.env.WORKOS_API_KEY = original;
      }
    });
  });

  describe('runEnvList', () => {
    it('shows info message when no environments', async () => {
      await runEnvList();
      expect(ui.log.info).toHaveBeenCalledWith(expect.stringContaining('No environments configured'));
    });

    it('does not throw when environments exist', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await expect(runEnvList()).resolves.not.toThrow();
    });

    it('prints an env-var override annotation when WORKOS_API_URL is set', async () => {
      process.env.WORKOS_API_URL = 'http://localhost:7777';
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await runEnvList();
      const lines = logSpy.mock.calls.map((c) => c.map(String).join(' '));
      expect(
        lines.some(
          (l) => l.includes('Override:') && l.includes('WORKOS_API_URL') && l.includes('http://localhost:7777'),
        ),
      ).toBe(true);
      logSpy.mockRestore();
    });

    it('shows the dashboard environment name in the table, falling back to the ID', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'legacy', apiKey: 'sk_live_def' });
      const config = getConfig()!;
      config.environments.prod.environmentId = 'environment_123';
      config.environments.prod.environmentName = 'Production';
      config.environments.legacy.environmentId = 'environment_456';
      saveConfig(config);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await runEnvList();
      const lines = logSpy.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.some((l) => l.includes('Environment'))).toBe(true);
      expect(lines.some((l) => l.includes('prod') && l.includes('Production'))).toBe(true);
      expect(lines.some((l) => l.includes('legacy') && l.includes('environment_456'))).toBe(true);
      logSpy.mockRestore();
    });

    it('does not print an override annotation when no env var is set', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await runEnvList();
      const lines = logSpy.mock.calls.map((c) => c.map(String).join(' '));
      expect(lines.some((l) => l.includes('Override:'))).toBe(false);
      logSpy.mockRestore();
    });
  });

  describe('runEnvProvision', () => {
    const CREDS = {
      clientId: 'client_x',
      apiKey: 'sk_test_x',
      claimToken: 'ct_x',
      authkitDomain: 'foo.authkit.app',
    };

    let consoleOutput: string[];
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.mocked(provisionUnclaimedEnvironment).mockReset();
      vi.mocked(writeCredentialsEnv).mockReset();
      consoleOutput = [];
      logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      });
    });

    afterEach(() => {
      logSpy.mockRestore();
      setOutputMode('human');
    });

    it('emits the provisioned credentials as JSON (agent credential delivery)', async () => {
      setOutputMode('json');
      vi.mocked(provisionUnclaimedEnvironment).mockResolvedValue(CREDS);

      await runEnvProvision();

      const out = JSON.parse(consoleOutput[0]);
      expect(out.status).toBe('ok');
      expect(out.data.apiKey).toBe('sk_test_x');
      expect(out.data.clientId).toBe('client_x');
      expect(out.data.claimToken).toBe('ct_x');
      expect(out.data.authkitDomain).toBe('foo.authkit.app');
    });

    it('persists the provisioned env locally as the active unclaimed env', async () => {
      setOutputMode('json');
      vi.mocked(provisionUnclaimedEnvironment).mockResolvedValue(CREDS);

      await runEnvProvision();

      const config = getConfig();
      const env = config?.environments.unclaimed;
      expect(env?.type).toBe('unclaimed');
      expect(env?.clientId).toBe('client_x');
      expect((env as { claimToken?: string } | undefined)?.claimToken).toBe('ct_x');
      expect(config?.activeEnvironment).toBe('unclaimed');
    });

    it('never writes a project .env file', async () => {
      setOutputMode('json');
      vi.mocked(provisionUnclaimedEnvironment).mockResolvedValue(CREDS);

      await runEnvProvision();

      expect(writeCredentialsEnv).not.toHaveBeenCalled();
    });

    it('preserves an existing unclaimed env (and its claim token) by using a fresh key', async () => {
      setOutputMode('json');
      vi.mocked(provisionUnclaimedEnvironment).mockResolvedValueOnce({
        clientId: 'client_old',
        apiKey: 'sk_test_old',
        claimToken: 'ct_old',
        authkitDomain: 'old.authkit.app',
      });
      await runEnvProvision();

      vi.mocked(provisionUnclaimedEnvironment).mockResolvedValueOnce(CREDS);
      await runEnvProvision();

      const config = getConfig();
      // The first env's claim token lives only in this config — it must never be clobbered.
      expect((config?.environments.unclaimed as { claimToken?: string } | undefined)?.claimToken).toBe('ct_old');
      const second = config?.environments['unclaimed-2'] as { claimToken?: string } | undefined;
      expect(second?.claimToken).toBe('ct_x');
      expect(config?.activeEnvironment).toBe('unclaimed-2');
      expect(JSON.parse(consoleOutput[1]).data.name).toBe('unclaimed-2');
    });

    it('surfaces a 429 as a structured rate_limited error — no config write, no login fallback', async () => {
      setOutputMode('json');
      setInteractionMode({ mode: 'agent', source: 'env' });
      vi.mocked(provisionUnclaimedEnvironment).mockRejectedValue(
        new UnclaimedEnvApiError('Rate limited. Please wait a moment and try again.', 429),
      );
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(runEnvProvision()).rejects.toThrow(CliExit);
        const parsed = JSON.parse(String(errorSpy.mock.calls[0][0]));
        expect(parsed.error.code).toBe('rate_limited');
        expect(getConfig()).toBeNull();
        expect(writeCredentialsEnv).not.toHaveBeenCalled();
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('maps an unexpected non-API error to provision_failed', async () => {
      setOutputMode('json');
      setInteractionMode({ mode: 'agent', source: 'env' });
      vi.mocked(provisionUnclaimedEnvironment).mockRejectedValue(new Error('boom'));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(runEnvProvision()).rejects.toThrow(CliExit);
        const parsed = JSON.parse(String(errorSpy.mock.calls[0][0]));
        expect(parsed.error.code).toBe('provision_failed');
      } finally {
        errorSpy.mockRestore();
      }
    });

    it('prints the credentials and the env-claim hint in human mode', async () => {
      setOutputMode('human');
      vi.mocked(provisionUnclaimedEnvironment).mockResolvedValue(CREDS);

      await runEnvProvision();

      expect(consoleOutput.join('\n')).toContain('sk_test_x');
      expect(ui.log.info).toHaveBeenCalledWith(expect.stringContaining('profile claim'));
    });
  });

  describe('JSON output mode', () => {
    let consoleOutput: string[];

    beforeEach(() => {
      setOutputMode('json');
      consoleOutput = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        consoleOutput.push(args.map(String).join(' '));
      });
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runEnvAdd outputs JSON success', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Environment added');
      expect(output.data.name).toBe('prod');
      expect(output.data.type).toBe('production');
      expect(output.data.active).toBe(true);
    });

    it('runEnvRemove outputs JSON success', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      consoleOutput = [];
      await runEnvRemove('prod');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Environment removed');
      expect(output.data.name).toBe('prod');
      expect(output.data.localOnly).toBe(true);
      expect(output.data.wasUnclaimed).toBe(false);
    });

    it('runEnvRemove reports wasUnclaimed for an unclaimed env in JSON', async () => {
      saveConfig({
        activeEnvironment: 'unclaimed',
        environments: {
          unclaimed: {
            name: 'unclaimed',
            type: 'unclaimed',
            apiKey: 'sk_test_abc',
            clientId: 'client_abc',
            claimToken: 'tok_abc',
          },
        },
      });
      consoleOutput = [];
      await runEnvRemove('unclaimed');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data.localOnly).toBe(true);
      expect(output.data.wasUnclaimed).toBe(true);
    });

    it('runEnvSwitch outputs JSON success', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
      consoleOutput = [];
      await runEnvSwitch('sandbox');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Switched environment');
      expect(output.data.name).toBe('sandbox');
    });

    it('runEnvSwitch includes warnings in JSON when WORKOS_API_KEY is set', async () => {
      const original = process.env.WORKOS_API_KEY;
      process.env.WORKOS_API_KEY = 'sk_test_override';
      try {
        await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
        await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
        consoleOutput = [];
        await runEnvSwitch('sandbox');
        const output = JSON.parse(consoleOutput[0]);
        expect(output.status).toBe('ok');
        expect(output.warnings).toHaveLength(1);
        expect(output.warnings[0].code).toBe('env_var_override');
      } finally {
        if (original === undefined) delete process.env.WORKOS_API_KEY;
        else process.env.WORKOS_API_KEY = original;
      }
    });

    it('runEnvList outputs JSON with data array', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await runEnvAdd({ name: 'sandbox', apiKey: 'sk_test_abc' });
      consoleOutput = [];
      await runEnvList();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(2);
      expect(output.data[0].name).toBe('prod');
      expect(output.data[0].active).toBe(true);
      expect(output.data[1].name).toBe('sandbox');
      expect(output.data[1].active).toBe(false);
      expect(output.data[0].environmentId).toBeNull();
      expect(output.data[0].environmentName).toBeNull();
    });

    it('runEnvList includes the stored environmentId and environmentName per profile', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      const config = getConfig()!;
      config.environments.prod.environmentId = 'environment_123';
      config.environments.prod.environmentName = 'Production';
      saveConfig(config);
      consoleOutput = [];
      await runEnvList();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data[0].environmentId).toBe('environment_123');
      expect(output.data[0].environmentName).toBe('Production');
    });

    it('runEnvList outputs empty data array when no environments', async () => {
      await runEnvList();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
    });

    it('runEnvList includes an override field when WORKOS_API_URL is set', async () => {
      process.env.WORKOS_API_URL = 'http://localhost:7777';
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      consoleOutput = [];
      await runEnvList();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.override).toEqual({ baseUrl: 'http://localhost:7777', via: 'WORKOS_API_URL' });
    });

    it('runEnvList override field is null when no env var is set', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      consoleOutput = [];
      await runEnvList();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.override).toBeNull();
    });
  });

  describe('command hints route through formatWorkOSCommand', () => {
    // getWorkOSCommand reads all three of these; clear/set them deterministically.
    const NPM_KEYS = ['npm_command', 'npm_execpath', 'npm_config_user_agent'] as const;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      saved = {};
      for (const k of NPM_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
      }
    });

    afterEach(() => {
      for (const k of NPM_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('runEnvList empty hint uses the bare command when not launched via npx', async () => {
      await runEnvList();
      expect(ui.log.info).toHaveBeenCalledWith(expect.stringContaining('workos profile add'));
      expect(ui.log.info).not.toHaveBeenCalledWith(expect.stringContaining('npx workos@latest'));
    });

    it('runEnvList empty hint keeps the standalone binary form when npm variables are present', async () => {
      process.env.npm_command = 'exec';
      await runEnvList();
      expect(ui.log.info).toHaveBeenCalledWith(expect.stringContaining('workos profile add'));
    });

    it('unclaimed-table footer keeps the standalone binary form when npm variables are present', async () => {
      process.env.npm_command = 'exec';
      saveConfig({
        activeEnvironment: 'unclaimed',
        environments: {
          unclaimed: {
            name: 'unclaimed',
            type: 'unclaimed',
            apiKey: 'sk_test_abc',
            clientId: 'client_abc',
            claimToken: 'tok_abc',
          },
        },
      });
      const out: string[] = [];
      vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        out.push(args.map(String).join(' '));
      });
      await runEnvList();
      expect(out.join('\n')).toContain('workos profile claim');
    });

    it('runEnvSwitch no-envs JSON error keeps the standalone binary form with npm variables present', async () => {
      process.env.npm_command = 'exec';
      setOutputMode('json');
      setInteractionMode({ mode: 'agent', source: 'env' });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(runEnvSwitch('anything')).rejects.toThrow(CliExit);
        const parsed = JSON.parse(String(errorSpy.mock.calls[0][0]));
        expect(parsed.error.message).toContain('workos profile add');
      } finally {
        errorSpy.mockRestore();
        setOutputMode('human');
      }
    });
  });
});
