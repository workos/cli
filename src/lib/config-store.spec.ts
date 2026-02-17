import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities BEFORE anything that imports config-store
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
}));

// Create a mock home directory for all tests
let testDir: string;
let workosDir: string;
let configFile: string;

// Mock os.homedir BEFORE importing config-store module
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

// Now import config-store module (after mock is set up)
const { getConfig, saveConfig, clearConfig, getActiveEnvironment, setInsecureConfigStorage, getConfigPath } =
  await import('./config-store.js');
import type { CliConfig, EnvironmentConfig } from './config-store.js';

describe('config-store', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'config-store-test-'));
    workosDir = join(testDir, '.workos');
    configFile = join(workosDir, 'config.json');
    // Force file-based storage for tests
    setInsecureConfigStorage(true);
  });

  afterEach(() => {
    if (existsSync(configFile)) unlinkSync(configFile);
    if (existsSync(workosDir)) rmdirSync(workosDir);
    if (existsSync(testDir)) rmdirSync(testDir);
  });

  const sampleEnv: EnvironmentConfig = {
    name: 'production',
    type: 'production',
    apiKey: 'sk_test_abc123',
  };

  const sampleConfig: CliConfig = {
    activeEnvironment: 'production',
    environments: {
      production: sampleEnv,
    },
  };

  describe('getConfigPath', () => {
    it('returns path in .workos directory', () => {
      const path = getConfigPath();
      expect(path).toContain('.workos');
      expect(path).toContain('config.json');
    });
  });

  describe('saveConfig', () => {
    it('creates .workos directory if it does not exist', () => {
      saveConfig(sampleConfig);
      expect(existsSync(workosDir)).toBe(true);
    });

    it('creates config file', () => {
      saveConfig(sampleConfig);
      expect(existsSync(configFile)).toBe(true);
    });

    it('saves config as JSON', () => {
      saveConfig(sampleConfig);
      const content = readFileSync(configFile, 'utf-8');
      const parsed = JSON.parse(content);
      expect(parsed.activeEnvironment).toBe('production');
      expect(parsed.environments.production.apiKey).toBe('sk_test_abc123');
    });

    it('creates file with 600 permissions', () => {
      saveConfig(sampleConfig);
      const stats = statSync(configFile);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it('creates directory with 700 permissions', () => {
      saveConfig(sampleConfig);
      const stats = statSync(workosDir);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o700);
    });
  });

  describe('getConfig', () => {
    it('returns null when file does not exist', () => {
      expect(getConfig()).toBeNull();
    });

    it('returns parsed config when file exists', () => {
      saveConfig(sampleConfig);
      const config = getConfig();
      expect(config).not.toBeNull();
      expect(config?.activeEnvironment).toBe('production');
      expect(config?.environments.production.name).toBe('production');
    });

    it('returns null for corrupted file', () => {
      saveConfig(sampleConfig);
      writeFileSync(configFile, 'not valid json');
      expect(getConfig()).toBeNull();
    });
  });

  describe('clearConfig', () => {
    it('removes config file', () => {
      saveConfig(sampleConfig);
      expect(existsSync(configFile)).toBe(true);
      clearConfig();
      expect(existsSync(configFile)).toBe(false);
    });

    it('handles missing file gracefully', () => {
      expect(() => clearConfig()).not.toThrow();
    });
  });

  describe('getActiveEnvironment', () => {
    it('returns null when no config exists', () => {
      expect(getActiveEnvironment()).toBeNull();
    });

    it('returns null when config has no active environment', () => {
      saveConfig({ environments: {} });
      expect(getActiveEnvironment()).toBeNull();
    });

    it('returns null when active environment does not exist in environments', () => {
      saveConfig({ activeEnvironment: 'missing', environments: {} });
      expect(getActiveEnvironment()).toBeNull();
    });

    it('returns the active environment config', () => {
      saveConfig(sampleConfig);
      const env = getActiveEnvironment();
      expect(env).not.toBeNull();
      expect(env?.name).toBe('production');
      expect(env?.apiKey).toBe('sk_test_abc123');
    });

    it('returns correct environment when multiple exist', () => {
      const multiConfig: CliConfig = {
        activeEnvironment: 'sandbox',
        environments: {
          production: sampleEnv,
          sandbox: {
            name: 'sandbox',
            type: 'sandbox',
            apiKey: 'sk_test_sandbox',
            endpoint: 'http://localhost:8001',
          },
        },
      };
      saveConfig(multiConfig);
      const env = getActiveEnvironment();
      expect(env?.name).toBe('sandbox');
      expect(env?.apiKey).toBe('sk_test_sandbox');
      expect(env?.endpoint).toBe('http://localhost:8001');
    });
  });
});
