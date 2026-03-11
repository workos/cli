import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
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
const mockGenerateCookiePassword = vi.fn(() => 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4');
vi.mock('./unclaimed-env-api.js', () => ({
  provisionUnclaimedEnvironment: (...args: unknown[]) => mockProvisionUnclaimedEnvironment(...args),
  generateCookiePassword: () => mockGenerateCookiePassword(),
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

    it('writes .env.local with all credentials including cookie password and claim token', async () => {
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

    it('generates cookie password', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(mockGenerateCookiePassword).toHaveBeenCalled();
    });

    it('shows provisioning message to user', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(mockClack.log.info).toHaveBeenCalledWith(expect.stringContaining('workos claim'));
    });

    it('returns false on API failure (network error)', async () => {
      mockProvisionUnclaimedEnvironment.mockRejectedValueOnce(new Error('Network error: DNS failed'));

      const result = await tryProvisionUnclaimedEnv({ installDir: testDir });

      expect(result).toBe(false);
      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('returns false on API failure (rate limit)', async () => {
      mockProvisionUnclaimedEnvironment.mockRejectedValueOnce(
        new Error('Rate limited. Please wait a moment and try again.'),
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

    it('writes redirect URI to .env.local when provided', async () => {
      mockProvisionUnclaimedEnvironment.mockResolvedValueOnce(validProvisionResult);

      await tryProvisionUnclaimedEnv({
        installDir: testDir,
        redirectUri: 'http://localhost:3000/callback',
        redirectUriKey: 'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
      });

      const content = readFileSync(join(testDir, '.env.local'), 'utf-8');
      expect(content).toContain('NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/callback');
    });

    it('uses WORKOS_REDIRECT_URI key by default when redirect URI provided', async () => {
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
