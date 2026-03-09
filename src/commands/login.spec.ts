import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
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
    },
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    })),
    isCancel: vi.fn(() => false),
  },
}));

// Mock staging API — we control it per test
const mockFetchStagingCredentials = vi.fn();
vi.mock('../lib/staging-api.js', () => ({
  fetchStagingCredentials: (...args: unknown[]) => mockFetchStagingCredentials(...args),
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
const { provisionStagingEnvironment } = await import('./login.js');

describe('login', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'login-test-'));
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

  describe('provisionStagingEnvironment', () => {
    it('creates a staging environment on success', async () => {
      mockFetchStagingCredentials.mockResolvedValueOnce({
        clientId: 'client_staging_123',
        apiKey: 'sk_test_staging_abc',
      });

      const result = await provisionStagingEnvironment('access_token_xyz');

      expect(result).toBe(true);
      expect(mockFetchStagingCredentials).toHaveBeenCalledWith('access_token_xyz');

      const config = getConfig();
      expect(config).not.toBeNull();
      expect(config?.environments['staging']).toEqual({
        name: 'staging',
        type: 'sandbox',
        apiKey: 'sk_test_staging_abc',
        clientId: 'client_staging_123',
      });
    });

    it('sets staging as active environment when no environments exist', async () => {
      mockFetchStagingCredentials.mockResolvedValueOnce({
        clientId: 'client_123',
        apiKey: 'sk_test_abc',
      });

      await provisionStagingEnvironment('token');

      const config = getConfig();
      expect(config?.activeEnvironment).toBe('staging');
    });

    it('does not change active environment when one already exists', async () => {
      // Pre-create an environment
      const { saveConfig } = await import('../lib/config-store.js');
      saveConfig({
        activeEnvironment: 'production',
        environments: {
          production: {
            name: 'production',
            type: 'production',
            apiKey: 'sk_live_existing',
          },
        },
      });

      mockFetchStagingCredentials.mockResolvedValueOnce({
        clientId: 'client_123',
        apiKey: 'sk_test_abc',
      });

      await provisionStagingEnvironment('token');

      const config = getConfig();
      expect(config?.activeEnvironment).toBe('production');
      expect(config?.environments['staging']).toBeDefined();
      expect(config?.environments['production']).toBeDefined();
    });

    it('updates existing staging environment if already present', async () => {
      const { saveConfig } = await import('../lib/config-store.js');
      saveConfig({
        activeEnvironment: 'staging',
        environments: {
          staging: {
            name: 'staging',
            type: 'sandbox',
            apiKey: 'sk_test_old',
            clientId: 'client_old',
          },
        },
      });

      mockFetchStagingCredentials.mockResolvedValueOnce({
        clientId: 'client_new',
        apiKey: 'sk_test_new',
      });

      const result = await provisionStagingEnvironment('token');

      expect(result).toBe(true);
      const config = getConfig();
      expect(config?.environments['staging']?.apiKey).toBe('sk_test_new');
      expect(config?.environments['staging']?.clientId).toBe('client_new');
    });

    it('returns false and does not throw on API 403 error', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('Access denied'));

      const result = await provisionStagingEnvironment('token');

      expect(result).toBe(false);
      const config = getConfig();
      expect(config).toBeNull();
    });

    it('returns false and does not throw on API 404 error', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('No staging environment found'));

      const result = await provisionStagingEnvironment('token');

      expect(result).toBe(false);
    });

    it('returns false and does not throw on network error', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('Network error'));

      const result = await provisionStagingEnvironment('token');

      expect(result).toBe(false);
    });

    it('returns false and does not throw on timeout', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('Request timed out'));

      const result = await provisionStagingEnvironment('token');

      expect(result).toBe(false);
    });
  });
});
