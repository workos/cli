import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  readFileSync,
  unlinkSync,
  mkdtempSync,
  rmdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
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

// Mock keyring storage
const mockKeyring = new Map<string, string>();
let keyringAvailable = true;

vi.mock('@napi-rs/keyring', () => ({
  Entry: class MockEntry {
    private key: string;

    constructor(
      service: string,
      private account: string,
    ) {
      this.key = `${service}:${account}`;
    }

    getPassword(): string | null {
      if (!keyringAvailable) {
        throw new Error('Keyring not available');
      }
      return mockKeyring.get(this.key) ?? null;
    }

    setPassword(password: string): void {
      if (!keyringAvailable) {
        throw new Error('Keyring not available');
      }
      mockKeyring.set(this.key, password);
    }

    deletePassword(): void {
      if (!keyringAvailable && mockKeyring.has(this.key)) {
        throw new Error('Keyring not available');
      }
      mockKeyring.delete(this.key);
    }
  },
}));

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

    // Reset state
    mockKeyring.clear();
    keyringAvailable = true;
    // Force file-based storage for most tests
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

    it('returns clientId when present', () => {
      saveConfig({
        activeEnvironment: 'staging',
        environments: {
          staging: {
            name: 'staging',
            type: 'sandbox',
            apiKey: 'sk_test_abc',
            clientId: 'client_01ABC',
          },
        },
      });
      const env = getActiveEnvironment();
      expect(env?.clientId).toBe('client_01ABC');
    });

    it('returns undefined clientId when not present', () => {
      saveConfig(sampleConfig);
      const env = getActiveEnvironment();
      expect(env?.clientId).toBeUndefined();
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

  describe('keyring storage (default)', () => {
    beforeEach(() => {
      setInsecureConfigStorage(false);
    });

    it('saves config to keyring', () => {
      saveConfig(sampleConfig);
      expect(mockKeyring.has('workos-cli:config')).toBe(true);
    });

    it('retrieves config from keyring', () => {
      saveConfig(sampleConfig);
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('production');
      expect(config?.environments.production.apiKey).toBe('sk_test_abc123');
    });

    it('does not write file when keyring succeeds', () => {
      saveConfig(sampleConfig);
      expect(mockKeyring.has('workos-cli:config')).toBe(true);
      expect(existsSync(configFile)).toBe(false);
    });

    it('does not delete existing file on keyring success', () => {
      // Create a pre-existing file (from a prior fallback write)
      mkdirSync(workosDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify(sampleConfig));

      saveConfig({ ...sampleConfig, activeEnvironment: 'staging' });

      expect(mockKeyring.has('workos-cli:config')).toBe(true);
      expect(existsSync(configFile)).toBe(true);
    });

    it('clears from both keyring and file', () => {
      saveConfig(sampleConfig);
      mkdirSync(workosDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify(sampleConfig));

      clearConfig();

      expect(mockKeyring.has('workos-cli:config')).toBe(false);
      expect(existsSync(configFile)).toBe(false);
    });
  });

  describe('file fallback (keyring unavailable)', () => {
    beforeEach(() => {
      setInsecureConfigStorage(false);
      keyringAvailable = false;
    });

    it('falls back to file when keyring unavailable', () => {
      saveConfig(sampleConfig);
      expect(existsSync(configFile)).toBe(true);
      expect(mockKeyring.has('workos-cli:config')).toBe(false);
    });

    it('reads from file when keyring unavailable', () => {
      saveConfig(sampleConfig);
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('production');
    });
  });

  describe('migration (file to keyring)', () => {
    beforeEach(() => {
      setInsecureConfigStorage(false);
    });

    it('migrates file config to keyring on read but keeps file', () => {
      mkdirSync(workosDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify(sampleConfig));

      const config = getConfig();

      expect(config?.activeEnvironment).toBe('production');
      expect(mockKeyring.has('workos-cli:config')).toBe(true);
      expect(existsSync(configFile)).toBe(true);
    });

    it('keeps file if keyring unavailable during migration', () => {
      mkdirSync(workosDir, { recursive: true });
      writeFileSync(configFile, JSON.stringify(sampleConfig));

      keyringAvailable = false;
      const config = getConfig();

      expect(config?.activeEnvironment).toBe('production');
      expect(existsSync(configFile)).toBe(true);
    });
  });
});
