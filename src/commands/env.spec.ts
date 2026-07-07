import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
}));

// Mock clack prompts
vi.mock('../utils/clack.js', () => ({
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
const clack = (await import('../utils/clack.js')).default;

describe('env commands', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-cmd-test-'));
    setInsecureConfigStorage(true);
    resetInteractionModeForTests();
    vi.clearAllMocks();
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
      expect(clack.text).not.toHaveBeenCalled();
    });

    it('requires name and API key in CI mode without prompting', async () => {
      setInteractionMode({ mode: 'ci', source: 'env' });
      await expect(runEnvAdd({ name: 'prod' })).rejects.toThrow(CliExit);
      expect(clack.text).not.toHaveBeenCalled();
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
      const warnMsg = vi.mocked(clack.log.warn).mock.calls.map((c) => String(c[0])).join('\n');
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
      const warnMsg = vi.mocked(clack.log.warn).mock.calls.map((c) => String(c[0])).join('\n');
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
      expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining('No environments configured'));
    });

    it('does not throw when environments exist', async () => {
      await runEnvAdd({ name: 'prod', apiKey: 'sk_live_abc' });
      await expect(runEnvList()).resolves.not.toThrow();
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
      expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining('env claim'));
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
    });

    it('runEnvList outputs empty data array when no environments', async () => {
      await runEnvList();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
    });
  });

  describe('command hints route through formatWorkOSCommand (npx vs bare)', () => {
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
      expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining('workos env add'));
      expect(clack.log.info).not.toHaveBeenCalledWith(expect.stringContaining('npx workos@latest'));
    });

    it('runEnvList empty hint uses npx form when launched via npm exec', async () => {
      process.env.npm_command = 'exec';
      await runEnvList();
      expect(clack.log.info).toHaveBeenCalledWith(expect.stringContaining('npx workos@latest env add'));
    });

    it('unclaimed-table footer uses npx form when launched via npm exec', async () => {
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
      expect(out.join('\n')).toContain('npx workos@latest env claim');
    });

    it('runEnvSwitch no-envs JSON error carries npx form', async () => {
      process.env.npm_command = 'exec';
      setOutputMode('json');
      setInteractionMode({ mode: 'agent', source: 'env' });
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await expect(runEnvSwitch('anything')).rejects.toThrow(CliExit);
        const parsed = JSON.parse(String(errorSpy.mock.calls[0][0]));
        expect(parsed.error.message).toContain('npx workos@latest env add');
      } finally {
        errorSpy.mockRestore();
        setOutputMode('human');
      }
    });
  });
});
