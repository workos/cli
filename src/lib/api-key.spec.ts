import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logWarn: vi.fn(),
}));

// Mock exitWithError — must throw to halt execution like process.exit
class ExitError extends Error {
  code: string;
  constructor(error: { code: string; message: string }) {
    super(error.message);
    this.code = error.code;
  }
}
const mockExitWithError = vi.fn((error: { code: string; message: string }) => {
  throw new ExitError(error);
});
vi.mock('../utils/output.js', () => ({
  exitWithError: (...args: unknown[]) => mockExitWithError(...(args as [{ code: string; message: string }])),
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
const { resolveApiKey, resolveOptionalApiKey, resolveApiBaseUrl, getApiBaseUrlSource } = await import('./api-key.js');

describe('api-key', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'api-key-test-'));
    setInsecureConfigStorage(true);
    process.env = { ...originalEnv };
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_API_URL;
    delete process.env.WORKOS_API_BASE_URL;
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
    it('returns --api-key flag over env var and stored key', () => {
      process.env.WORKOS_API_KEY = 'sk_env_var';
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey({ apiKey: 'sk_flag' })).toBe('sk_flag');
    });

    it('returns WORKOS_API_KEY env var when no flag provided', () => {
      process.env.WORKOS_API_KEY = 'sk_env_var';
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey()).toBe('sk_env_var');
    });

    it('returns active environment API key when no env var or flag', () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveApiKey()).toBe('sk_stored');
    });

    it('exits with error when no API key available', () => {
      expect(() => resolveApiKey()).toThrow(ExitError);
      expect(mockExitWithError).toHaveBeenCalledWith(expect.objectContaining({ code: 'no_api_key' }));
    });

    it('exits with error when config exists but no active environment', () => {
      saveConfig({ environments: {} });
      expect(() => resolveApiKey()).toThrow(ExitError);
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

  describe('resolveOptionalApiKey', () => {
    it('returns --api-key flag over env var and stored key', () => {
      process.env.WORKOS_API_KEY = 'sk_env_var';
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveOptionalApiKey({ apiKey: 'sk_flag' })).toBe('sk_flag');
    });

    it('returns WORKOS_API_KEY env var when no flag provided', () => {
      process.env.WORKOS_API_KEY = 'sk_env_var';
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveOptionalApiKey()).toBe('sk_env_var');
    });

    it('returns undefined when no API key is available', () => {
      mockExitWithError.mockClear();
      expect(resolveOptionalApiKey()).toBeUndefined();
      expect(mockExitWithError).not.toHaveBeenCalled();
    });

    it('returns configured API key when available', () => {
      saveConfig({
        activeEnvironment: 'prod',
        environments: { prod: { name: 'prod', type: 'production', apiKey: 'sk_stored' } },
      });
      expect(resolveOptionalApiKey()).toBe('sk_stored');
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

    it('returns WORKOS_API_URL over a profile endpoint', () => {
      process.env.WORKOS_API_URL = 'http://localhost:7777';
      saveConfig({
        activeEnvironment: 'local',
        environments: {
          local: { name: 'local', type: 'sandbox', apiKey: 'sk_test', endpoint: 'http://localhost:8001' },
        },
      });
      expect(resolveApiBaseUrl()).toBe('http://localhost:7777');
    });

    it('uses WORKOS_API_BASE_URL as an alias when WORKOS_API_URL is unset', () => {
      process.env.WORKOS_API_BASE_URL = 'http://localhost:9999';
      expect(resolveApiBaseUrl()).toBe('http://localhost:9999');
    });

    it('prefers WORKOS_API_URL over WORKOS_API_BASE_URL when both are set', () => {
      process.env.WORKOS_API_URL = 'http://localhost:7777';
      process.env.WORKOS_API_BASE_URL = 'http://localhost:9999';
      expect(resolveApiBaseUrl()).toBe('http://localhost:7777');
    });

    it('ignores an empty WORKOS_API_URL and falls through to the default', () => {
      process.env.WORKOS_API_URL = '';
      expect(resolveApiBaseUrl()).toBe('https://api.workos.com');
    });

    it('strips a trailing slash from the env override', () => {
      process.env.WORKOS_API_URL = 'http://localhost:7777/';
      expect(resolveApiBaseUrl()).toBe('http://localhost:7777');
    });

    it('exits with a friendly error when WORKOS_API_URL is malformed', () => {
      process.env.WORKOS_API_URL = 'not a url';
      expect(() => resolveApiBaseUrl()).toThrow(ExitError);
      expect(mockExitWithError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_api_url' }));
    });

    it('exits when WORKOS_API_URL uses an unsupported scheme', () => {
      process.env.WORKOS_API_URL = 'ftp://localhost:7777';
      expect(() => resolveApiBaseUrl()).toThrow(ExitError);
      expect(mockExitWithError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid_api_url' }));
    });
  });

  describe('getApiBaseUrlSource', () => {
    it('reports the default source when nothing is configured', () => {
      expect(getApiBaseUrlSource()).toEqual({ baseUrl: 'https://api.workos.com', source: 'default' });
    });

    it('reports the env source and which var was used', () => {
      process.env.WORKOS_API_URL = 'http://localhost:7777';
      expect(getApiBaseUrlSource()).toEqual({
        baseUrl: 'http://localhost:7777',
        source: 'env',
        via: 'WORKOS_API_URL',
      });
    });

    it('reports the alias var name when only WORKOS_API_BASE_URL is set', () => {
      process.env.WORKOS_API_BASE_URL = 'http://localhost:9999';
      expect(getApiBaseUrlSource()).toEqual({
        baseUrl: 'http://localhost:9999',
        source: 'env',
        via: 'WORKOS_API_BASE_URL',
      });
    });

    it('reports the profile source and name', () => {
      saveConfig({
        activeEnvironment: 'local',
        environments: {
          local: { name: 'local', type: 'sandbox', apiKey: 'sk_test', endpoint: 'http://localhost:8001' },
        },
      });
      expect(getApiBaseUrlSource()).toEqual({
        baseUrl: 'http://localhost:8001',
        source: 'profile',
        via: 'local',
      });
    });
  });
});
