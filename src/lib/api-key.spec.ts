import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
}));

let testDir: string;

// Mock os.homedir for config-store
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

const { saveConfig, setInsecureConfigStorage, clearConfig } = await import('./config-store.js');
const { resolveApiKey, resolveApiBaseUrl } = await import('./api-key.js');

describe('api-key', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'api-key-test-'));
    setInsecureConfigStorage(true);
    process.env = { ...originalEnv };
    delete process.env.WORKOS_API_KEY;
  });

  afterEach(() => {
    clearConfig();
    process.env = originalEnv;
    try {
      rmdirSync(join(testDir, '.workos'), { recursive: true });
    } catch {}
    try {
      rmdirSync(testDir);
    } catch {}
  });

  describe('resolveApiKey', () => {
    it('returns WORKOS_API_KEY env var when set', () => {
      process.env.WORKOS_API_KEY = 'sk_env_var';
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey({ apiKey: 'sk_flag' })).toBe('sk_env_var');
    });

    it('returns --api-key flag when env var not set', () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey({ apiKey: 'sk_flag' })).toBe('sk_flag');
    });

    it('returns active environment API key when no env var or flag', () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey()).toBe('sk_stored');
    });

    it('throws when no API key available', () => {
      expect(() => resolveApiKey()).toThrow(/No API key/);
    });

    it('throws when config exists but no active environment', () => {
      saveConfig({ environments: {} });
      expect(() => resolveApiKey()).toThrow(/No API key/);
    });

    it('ignores empty string env var', () => {
      process.env.WORKOS_API_KEY = '';
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey()).toBe('sk_stored');
    });

    it('ignores empty string flag', () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey({ apiKey: '' })).toBe('sk_stored');
    });
  });

  describe('resolveApiBaseUrl', () => {
    it('returns default URL when no config', () => {
      expect(resolveApiBaseUrl()).toBe('https://api.workos.com');
    });

    it('returns default URL when active env has no endpoint', () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_test' } },
      });
      expect(resolveApiBaseUrl()).toBe('https://api.workos.com');
    });

    it('returns custom endpoint from active environment', () => {
      saveConfig({
        activeEnvironment: 'local',
        environments: {
          local: { name: 'local', type: 'sandbox', apiKey: 'sk_test', endpoint: 'http://localhost:8001' },
        },
      });
      expect(resolveApiBaseUrl()).toBe('http://localhost:8001');
    });
  });
});
