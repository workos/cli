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

const { getConfig, setInsecureConfigStorage, clearConfig } = await import('../lib/config-store.js');
const { runEnvAdd, runEnvRemove, runEnvSwitch, runEnvList } = await import('./env.js');
const { setOutputMode } = await import('../utils/output.js');
const clack = (await import('../utils/clack.js')).default;

// Spy on process.exit
vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

describe('env commands', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'env-cmd-test-'));
    setInsecureConfigStorage(true);
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearConfig();
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
      await expect(runEnvAdd({ name: 'INVALID NAME', apiKey: 'sk_test' })).rejects.toThrow('process.exit');
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
      await expect(runEnvRemove('missing')).rejects.toThrow('process.exit');
    });

    it('errors when no environments configured', async () => {
      await expect(runEnvRemove('anything')).rejects.toThrow('process.exit');
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
      await expect(runEnvSwitch('missing')).rejects.toThrow('process.exit');
    });

    it('errors when no environments configured', async () => {
      await expect(runEnvSwitch('anything')).rejects.toThrow('process.exit');
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
});
