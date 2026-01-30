import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, mkdtempSync, rmdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Credentials } from './credentials.js';

// Create a mock home directory for all tests
let testDir: string;
let wizardDir: string;
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
}));

// Mock settings
vi.mock('./settings.js', () => ({
  getCliAuthClientId: vi.fn(() => 'test_client_id'),
  getAuthkitDomain: vi.fn(() => 'https://auth.test.com'),
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
const { saveCredentials, clearCredentials, getCredentials } = await import('./credentials.js');
const { ensureAuthenticated } = await import('./ensure-auth.js');

describe('ensure-auth', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'ensure-auth-test-'));
    wizardDir = join(testDir, '.workos');
    credentialsFile = join(wizardDir, 'credentials.json');
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up
    if (existsSync(credentialsFile)) {
      unlinkSync(credentialsFile);
    }
    if (existsSync(wizardDir)) {
      rmdirSync(wizardDir);
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
      mkdirSync(wizardDir, { recursive: true });
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

      expect(mockRefreshAccessToken).toHaveBeenCalledWith(
        'https://auth.test.com',
        'test_client_id',
      );
    });
  });
});
