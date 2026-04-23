import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

// Mock clack
const mockClack = {
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
  },
};
vi.mock('../utils/clack.js', () => ({ default: mockClack }));

// Mock config-store — track calls
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockGetActiveEnvironment = vi.fn(() => null);
vi.mock('./config-store.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
}));

// Mock unclaimed-env-api
const mockProvisionUnclaimedEnvironment = vi.fn();
vi.mock('./unclaimed-env-api.js', () => ({
  provisionUnclaimedEnvironment: (...args: unknown[]) => mockProvisionUnclaimedEnvironment(...args),
  UnclaimedEnvApiError: class UnclaimedEnvApiError extends Error {
    constructor(
      message: string,
      public readonly statusCode?: number,
    ) {
      super(message);
      this.name = 'UnclaimedEnvApiError';
    }
  },
}));

// Mock box utility
vi.mock('../utils/box.js', () => ({
  renderStderrBox: vi.fn(),
}));

const { tryProvisionUnclaimedEnv } = await import('./unclaimed-env-provision.js');

describe('unclaimed-env-provision', () => {
  let testDir: string;

  const validProvisionResult = {
    clientId: 'client_01ABC',
    apiKey: 'sk_test_oneshot',
    claimToken: 'ct_token123',
    authkitDomain: 'auth.example.com',
  };

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'unclaimed-env-provision-test-'));
    vi.clearAllMocks();
    mockGetConfig.mockReturnValue(null);
    // Read-back after save should return the unclaimed env by default
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_oneshot',
      clientId: 'client_01ABC',
      claimToken: 'ct_token123',
    });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('tryProvisionUnclaimedEnv', () => {
    it('returns true on successful provisioning', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      const result = await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(result).toBe(true);
    });

    it('saves config with type unclaimed and sets as active', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(mockSaveConfig).toHaveBeenCalledWith({
        environments: {
          unclaimed: {
            name: 'unclaimed',
            type: 'unclaimed',
            apiKey: 'sk_test_oneshot',
            clientId: 'client_01ABC',
            claimToken: 'ct_token123',
          },
        },
        activeEnvironment: 'unclaimed',
      });
    });

    it('preserves existing config environments', async () => {
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'production',
        environments: {
          production: {
            name: 'production',
            type: 'production',
            apiKey: 'sk_live_existing',
          },
        },
      });
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          environments: expect.objectContaining({
            production: expect.objectContaining({ apiKey: 'sk_live_existing' }),
            unclaimed: expect.objectContaining({ type: 'unclaimed' }),
          }),
          activeEnvironment: 'unclaimed',
        }),
      );
    });

    it('writes .env.local with all credentials including cookie password and claim token (JS project)', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}');
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      const envPath = join(testDir, '.env.local');
      expect(existsSync(envPath)).toBe(true);
      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('WORKOS_API_KEY=sk_test_oneshot');
      expect(content).toContain('WORKOS_CLIENT_ID=client_01ABC');
      expect(content).toContain('WORKOS_COOKIE_PASSWORD=');
      expect(content).toContain('WORKOS_CLAIM_TOKEN=ct_token123');
    });

    it('writes .env (no cookie password) when no package.json present (non-JS project)', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(existsSync(join(testDir, '.env.local'))).toBe(false);
      const envPath = join(testDir, '.env');
      expect(existsSync(envPath)).toBe(true);
      const content = readFileSync(envPath, 'utf-8');
      expect(content).toContain('WORKOS_API_KEY=sk_test_oneshot');
      expect(content).toContain('WORKOS_CLIENT_ID=client_01ABC');
      expect(content).toContain('WORKOS_CLAIM_TOKEN=ct_token123');
      expect(content).not.toContain('WORKOS_COOKIE_PASSWORD');
    });

    it('shows provisioning message to user', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);
      const { renderStderrBox } = await import('../utils/box.js');

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(renderStderrBox).toHaveBeenCalled();
    });

    it('returns false when config read-back fails after save', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);
      // Read-back returns null — simulates keyring write that silently fails
      mockGetActiveEnvironment.mockReturnValue(null);

      const result = await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(result).toBe(false);
      expect(mockSaveConfig).toHaveBeenCalled();
      expect(mockClack.log.warn).toHaveBeenCalledWith(expect.stringContaining('config storage may be unreliable'));
    });

    it('returns false on API failure (network error)', async () => {
      mockProvisionUnclaimedEnvironment.mockRejectedValueOnce(new Error('Network error: DNS failed'));

      const result = await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(result).toBe(false);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('returns false on API failure (rate limit)', async () => {
      const { UnclaimedEnvApiError } = await import('./unclaimed-env-api.js');
      mockProvisionUnclaimedEnvironment.mockRejectedValueOnce(
        new UnclaimedEnvApiError('Rate limited. Please wait a moment and try again.', 429),
      );

      const result = await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(result).toBe(false);
      expect(mockClack.log.warn).toHaveBeenCalledWith(expect.stringContaining('falling back to login'));
    });

    it('returns false on API failure (server error)', async () => {
      mockProvisionUnclaimedEnvironment.mockRejectedValueOnce(new Error('Server error: 500'));

      const result = await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(result).toBe(false);
    });

    it('writes redirect URI to .env.local when provided (JS project)', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}');
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({
        installDir: testDir,
        redirectUri: 'http://localhost:3000/callback',
        redirectUriKey: 'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
      });

      const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
      expect(content).toContain('NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback');
    });

    it('uses WORKOS_REDIRECT_URI key by default when redirect URI provided (JS project)', async () => {
      writeFileSync(join(testDir, 'package.json'), '{}');
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({
        installDir: testDir,
        redirectUri: 'http://localhost:3000/callback',
      });

      const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
      expect(content).toContain('WORKOS_REDIRECT_URI=http://localhost:3000/callback');
    });
  });
});
