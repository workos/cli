import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Credentials } from './credentials.js';

// Create a mock home directory for all tests
let testDir: string;
let installerDir: string;
let credentialsFile: string;

// Mock os.homedir BEFORE importing modules
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

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

// Mock settings (getConfig needed by constants.ts via environment.ts import chain)
vi.mock('./settings.js', () => ({
  getCliAuthClientId: vi.fn(() => 'test_client_id'),
  getAuthkitDomain: vi.fn(() => 'https://auth.test.com'),
  getConfig: vi.fn(() => ({
    nodeVersion: '>=20',
    logging: { debugMode: false },
    documentation: { workosDocsUrl: '', dashboardUrl: '', issuesUrl: '' },
    telemetry: { enabled: false, eventName: '' },
    legacy: { oauthPort: 0 },
  })),
}));

// Mock environment detection
const mockIsNonInteractive = vi.fn(() => false);
vi.mock('../utils/environment.js', () => ({
  isNonInteractiveEnvironment: () => mockIsNonInteractive(),
}));

// Mock exit codes — must throw to halt execution like the real process.exit()
class AuthRequiredExit extends Error {
  constructor() {
    super('auth_required_exit');
  }
}
const mockExitWithAuthRequired = vi.fn(() => {
  throw new AuthRequiredExit();
});
vi.mock('../utils/exit-codes.js', () => ({
  exitWithAuthRequired: (...args: unknown[]) => mockExitWithAuthRequired(...args),
}));

// Mock runLogin
const mockRunLogin = vi.fn();
vi.mock('../commands/login.js', () => ({
  runLogin: () => mockRunLogin(),
}));

// Mock refreshAccessToken
const mockRefreshAccessToken = vi.fn();
vi.mock('./token-refresh-client.js', () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
}));

// Import after mocks are set up
const { saveCredentials, getCredentials, setInsecureStorage, hasCredentials } = await import('./credentials.js');
const { ensureAuthenticated } = await import('./ensure-auth.js');

describe('ensure-auth', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'ensure-auth-test-'));
    installerDir = join(testDir, '.workos');
    credentialsFile = join(installerDir, 'credentials.json');
    vi.clearAllMocks();
    // Force file-based storage for these tests
    setInsecureStorage(true);
  });

  afterEach(() => {
    // Clean up
    if (existsSync(credentialsFile)) {
      unlinkSync(credentialsFile);
    }
    if (existsSync(installerDir)) {
      rmdirSync(installerDir);
    }
    if (existsSync(testDir)) {
      rmdirSync(testDir);
    }
  });

  const validCreds: Credentials = {
    accessToken: 'access_token_123',
    expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour from now
    userId: 'user_abc',
    email: 'test@example.com',
    refreshToken: 'refresh_token_456',
  };

  const expiredAccessCreds: Credentials = {
    ...validCreds,
    expiresAt: Date.now() - 1000, // 1 second ago
  };

  const expiredCredsNoRefresh: Credentials = {
    accessToken: 'access_token_123',
    expiresAt: Date.now() - 1000,
    userId: 'user_abc',
    email: 'test@example.com',
  };

  describe('ensureAuthenticated', () => {
    it('returns authenticated=true for valid credentials', async () => {
      saveCredentials(validCreds);

      const result = await ensureAuthenticated();

      expect(result.authenticated).toBe(true);
      expect(result.loginTriggered).toBe(false);
      expect(result.tokenRefreshed).toBe(false);
      expect(mockRunLogin).not.toHaveBeenCalled();
    });

    it('triggers login when no credentials exist', async () => {
      // Setup: login creates credentials
      mockRunLogin.mockImplementation(() => {
        saveCredentials(validCreds);
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(mockRunLogin).toHaveBeenCalledOnce();
    });

    it('triggers login when credentials file is invalid JSON', async () => {
      // Create invalid credentials file
      const { mkdirSync } = await import('node:fs');
      mkdirSync(installerDir, { recursive: true });
      writeFileSync(credentialsFile, 'not valid json');

      mockRunLogin.mockImplementation(() => {
        saveCredentials(validCreds);
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(mockRunLogin).toHaveBeenCalledOnce();
    });

    it('silently refreshes when access token expired but refresh token valid', async () => {
      saveCredentials(expiredAccessCreds);

      const newExpiry = Date.now() + 60 * 60 * 1000;
      mockRefreshAccessToken.mockResolvedValue({
        success: true,
        accessToken: 'new_access_token',
        expiresAt: newExpiry,
        refreshToken: 'new_refresh_token',
      });

      const result = await ensureAuthenticated();

      expect(result.authenticated).toBe(true);
      expect(result.tokenRefreshed).toBe(true);
      expect(result.loginTriggered).toBe(false);
      expect(mockRunLogin).not.toHaveBeenCalled();

      // Verify credentials were updated
      const updatedCreds = getCredentials();
      expect(updatedCreds?.accessToken).toBe('new_access_token');
    });

    it('triggers login when refresh token is expired (invalid_grant)', async () => {
      saveCredentials(expiredAccessCreds);

      mockRefreshAccessToken.mockResolvedValue({
        success: false,
        errorType: 'invalid_grant',
        error: 'Refresh token expired',
      });

      mockRunLogin.mockImplementation(() => {
        saveCredentials(validCreds);
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(mockRunLogin).toHaveBeenCalledOnce();
    });

    it('triggers login when no refresh token available', async () => {
      saveCredentials(expiredCredsNoRefresh);

      mockRunLogin.mockImplementation(() => {
        saveCredentials(validCreds);
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(mockRunLogin).toHaveBeenCalledOnce();
    });

    it('falls back to login on network error during refresh', async () => {
      saveCredentials(expiredAccessCreds);

      mockRefreshAccessToken.mockResolvedValue({
        success: false,
        errorType: 'network',
        error: 'Network error',
      });

      mockRunLogin.mockImplementation(() => {
        saveCredentials(validCreds);
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(result.authenticated).toBe(true);
      expect(mockRunLogin).toHaveBeenCalledOnce();
    });

    it('falls back to login on server error during refresh', async () => {
      saveCredentials(expiredAccessCreds);

      mockRefreshAccessToken.mockResolvedValue({
        success: false,
        errorType: 'server',
        error: 'Server error',
      });

      mockRunLogin.mockImplementation(() => {
        saveCredentials(validCreds);
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(mockRunLogin).toHaveBeenCalledOnce();
    });

    it('returns authenticated=false if login is cancelled', async () => {
      // No credentials, login doesn't create them (user cancelled)
      mockRunLogin.mockImplementation(() => {
        // Don't save credentials - simulates user cancelling
      });

      const result = await ensureAuthenticated();

      expect(result.loginTriggered).toBe(true);
      expect(result.authenticated).toBe(false);
    });

    it('calls refreshAccessToken with correct parameters', async () => {
      saveCredentials(expiredAccessCreds);

      mockRefreshAccessToken.mockResolvedValue({
        success: true,
        accessToken: 'new_token',
        expiresAt: Date.now() + 3600000,
      });

      await ensureAuthenticated();

      expect(mockRefreshAccessToken).toHaveBeenCalledWith('https://auth.test.com', 'test_client_id');
    });

    describe('credential clearing on failure', () => {
      it('clears stale credentials when refresh fails with invalid_grant', async () => {
        saveCredentials(expiredAccessCreds);
        expect(hasCredentials()).toBe(true);

        mockRefreshAccessToken.mockResolvedValue({
          success: false,
          errorType: 'invalid_grant',
          error: 'Refresh token expired',
        });

        mockRunLogin.mockImplementation(() => {
          saveCredentials(validCreds);
        });

        await ensureAuthenticated();

        // Credentials were cleared before runLogin, then runLogin saved new ones
        expect(mockRunLogin).toHaveBeenCalledOnce();
      });

      it('clears credentials when refresh fails with network error', async () => {
        saveCredentials(expiredAccessCreds);

        mockRefreshAccessToken.mockResolvedValue({
          success: false,
          errorType: 'network',
          error: 'Network error',
        });

        // Don't save new creds in login — verify old ones were cleared
        mockRunLogin.mockImplementation(() => {});

        await ensureAuthenticated();

        // Old stale credentials should be gone
        expect(hasCredentials()).toBe(false);
      });

      it('clears credentials when no refresh token available', async () => {
        saveCredentials(expiredCredsNoRefresh);

        mockRunLogin.mockImplementation(() => {});

        await ensureAuthenticated();

        expect(hasCredentials()).toBe(false);
      });

      it('does NOT clear credentials on successful refresh', async () => {
        saveCredentials(expiredAccessCreds);

        mockRefreshAccessToken.mockResolvedValue({
          success: true,
          accessToken: 'new_access_token',
          expiresAt: Date.now() + 3600000,
          refreshToken: 'new_refresh_token',
        });

        const result = await ensureAuthenticated();

        expect(result.authenticated).toBe(true);
        expect(hasCredentials()).toBe(true);
        const creds = getCredentials();
        expect(creds?.accessToken).toBe('new_access_token');
      });
    });

    describe('non-TTY mode', () => {
      beforeEach(() => {
        mockIsNonInteractive.mockReturnValue(true);
      });

      afterEach(() => {
        mockIsNonInteractive.mockReturnValue(false);
      });

      it('exits with auth required when no credentials in non-TTY', async () => {
        // No credentials saved, non-TTY mode
        await expect(ensureAuthenticated()).rejects.toThrow(AuthRequiredExit);

        expect(mockExitWithAuthRequired).toHaveBeenCalled();
        expect(mockRunLogin).not.toHaveBeenCalled();
      });

      it('still refreshes tokens silently in non-TTY', async () => {
        saveCredentials(expiredAccessCreds);

        mockRefreshAccessToken.mockResolvedValue({
          success: true,
          accessToken: 'new_token',
          expiresAt: Date.now() + 3600000,
          refreshToken: 'new_refresh',
        });

        const result = await ensureAuthenticated();

        expect(result.tokenRefreshed).toBe(true);
        expect(result.authenticated).toBe(true);
        expect(mockExitWithAuthRequired).not.toHaveBeenCalled();
        expect(mockRunLogin).not.toHaveBeenCalled();
      });

      it('exits with auth required when refresh fails in non-TTY', async () => {
        saveCredentials(expiredAccessCreds);

        mockRefreshAccessToken.mockResolvedValue({
          success: false,
          errorType: 'invalid_grant',
          error: 'Refresh token expired',
        });

        await expect(ensureAuthenticated()).rejects.toThrow(AuthRequiredExit);

        expect(mockExitWithAuthRequired).toHaveBeenCalled();
        expect(mockRunLogin).not.toHaveBeenCalled();
      });
    });
  });
});
