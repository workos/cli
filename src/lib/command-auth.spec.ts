import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, unlinkSync, rmdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Credentials } from './credentials.js';

// Create a mock home directory for all tests (same fixture pattern as
// ensure-auth.spec.ts: real credential store, file-backed, isolated homedir).
let testDir: string;
let installerDir: string;
let credentialsFile: string;

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

vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

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

const mockRefreshAccessToken = vi.fn();
vi.mock('./token-refresh-client.js', () => ({
  refreshAccessToken: (...args: unknown[]) => mockRefreshAccessToken(...args),
}));

// Pass-through spy: keep the REAL credential store (file-backed via the mocked
// homedir) while recording updateTokens calls, so tests can pin "persisted
// exactly once" without faking the store.
const updateTokensSpy = vi.fn();
vi.mock('./credentials.js', async (importActual) => {
  const actual = await importActual<typeof import('./credentials.js')>();
  return {
    ...actual,
    updateTokens: (...args: Parameters<typeof actual.updateTokens>) => {
      updateTokensSpy(...args);
      return actual.updateTokens(...args);
    },
  };
});

// Import after mocks are set up. exit-codes is deliberately REAL: the matrix
// asserts the thrown CliExit's exit code and errorCode.
const { saveCredentials, getCredentials, setInsecureStorage, hasCredentials } = await import('./credentials.js');
const { getCliAuthClientId } = await import('./settings.js');
const { formatWorkOSCommand } = await import('../utils/command-invocation.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { refreshIfExpired, requireCommandToken, DASHBOARD_ERROR_MESSAGES } = await import('./command-auth.js');

async function expectAuthExit(promise: Promise<unknown>): Promise<CliExit> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(4);
      expect(err.context?.errorCode).toBe('auth_required');
      return err;
    }
    throw err;
  }
  throw new Error('Expected CliExit(4) but promise resolved');
}

describe('command-auth', () => {
  let consoleErrors: string[];

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'command-auth-test-'));
    installerDir = join(testDir, '.workos');
    credentialsFile = join(installerDir, 'credentials.json');
    vi.clearAllMocks();
    setInsecureStorage(true);
    // Isolate from a developer machine where WORKOS_API_KEY may be exported.
    vi.stubEnv('WORKOS_API_KEY', '');
    consoleErrors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    if (existsSync(credentialsFile)) unlinkSync(credentialsFile);
    if (existsSync(installerDir)) rmdirSync(installerDir);
    if (existsSync(testDir)) rmdirSync(testDir);
  });

  const validCreds: Credentials = {
    accessToken: 'access_token_123',
    expiresAt: Date.now() + 60 * 60 * 1000,
    userId: 'user_abc',
    email: 'test@example.com',
    refreshToken: 'refresh_token_456',
  };

  const expiredCreds: Credentials = {
    ...validCreds,
    expiresAt: Date.now() - 1000,
  };

  const expiredCredsNoRefresh: Credentials = {
    accessToken: 'access_token_123',
    expiresAt: Date.now() - 1000,
    userId: 'user_abc',
    email: 'test@example.com',
  };

  describe('refreshIfExpired', () => {
    it('returns the stored token without refreshing when still valid', async () => {
      saveCredentials(validCreds);

      const session = await refreshIfExpired();

      expect(session).toEqual({ accessToken: 'access_token_123', refreshed: false });
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('returns null when no credentials exist', async () => {
      const session = await refreshIfExpired();

      expect(session).toBeNull();
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('refreshes an expired token and persists the new tokens', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({
        success: true,
        accessToken: 'new_access_token',
        expiresAt: Date.now() + 3_600_000,
        refreshToken: 'new_refresh_token',
      });

      const session = await refreshIfExpired();

      expect(session).toEqual({ accessToken: 'new_access_token', refreshed: true });
      expect(mockRefreshAccessToken).toHaveBeenCalledExactlyOnceWith('https://auth.test.com', 'test_client_id');
      expect(updateTokensSpy).toHaveBeenCalledExactlyOnceWith('new_access_token', expect.any(Number), 'new_refresh_token');
      const stored = getCredentials();
      expect(stored?.accessToken).toBe('new_access_token');
      expect(stored?.refreshToken).toBe('new_refresh_token');
    });

    it('clears credentials and returns null on invalid_grant', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({
        success: false,
        errorType: 'invalid_grant',
        error: 'Refresh token expired',
      });

      const session = await refreshIfExpired();

      expect(session).toBeNull();
      expect(hasCredentials()).toBe(false);
    });

    it('keeps credentials and returns null on a network error', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({ success: false, errorType: 'network', error: 'Network error' });

      const session = await refreshIfExpired();

      expect(session).toBeNull();
      expect(hasCredentials()).toBe(true);
    });

    it('keeps credentials and returns null on a server (5xx) error', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({ success: false, errorType: 'server', error: 'Server error' });

      const session = await refreshIfExpired();

      expect(session).toBeNull();
      expect(hasCredentials()).toBe(true);
    });

    it('clears credentials when expired with no refresh token', async () => {
      saveCredentials(expiredCredsNoRefresh);

      const session = await refreshIfExpired();

      expect(session).toBeNull();
      expect(hasCredentials()).toBe(false);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('clears credentials when the auth client config is missing', async () => {
      saveCredentials(expiredCreds);
      vi.mocked(getCliAuthClientId).mockReturnValueOnce(undefined as unknown as string);

      const session = await refreshIfExpired();

      expect(session).toBeNull();
      expect(hasCredentials()).toBe(false);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });
  });

  describe('requireCommandToken', () => {
    it('resolves the stored token when still valid', async () => {
      saveCredentials(validCreds);

      await expect(requireCommandToken()).resolves.toBe('access_token_123');
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('silently refreshes an expired token and proceeds', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({
        success: true,
        accessToken: 'new_access_token',
        expiresAt: Date.now() + 3_600_000,
        refreshToken: 'new_refresh_token',
      });

      await expect(requireCommandToken()).resolves.toBe('new_access_token');
      expect(mockRefreshAccessToken).toHaveBeenCalledOnce();
      // Tokens were persisted exactly once via updateTokens.
      expect(updateTokensSpy).toHaveBeenCalledOnce();
      expect(getCredentials()?.accessToken).toBe('new_access_token');
    });

    it('exits 4 and clears credentials when refresh fails with invalid_grant', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({
        success: false,
        errorType: 'invalid_grant',
        error: 'Refresh token expired',
      });

      await expectAuthExit(requireCommandToken());

      expect(hasCredentials()).toBe(false);
      expect(consoleErrors.join('\n')).toContain(DASHBOARD_ERROR_MESSAGES.authRequired);
    });

    it('exits 4 but KEEPS credentials on a transient refresh failure, wording it as such', async () => {
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({ success: false, errorType: 'network', error: 'Network error' });

      await expectAuthExit(requireCommandToken());

      expect(hasCredentials()).toBe(true);
      const err = consoleErrors.join('\n');
      // The message must say the refresh failed — not that the user is logged out.
      expect(err).toContain(DASHBOARD_ERROR_MESSAGES.refreshFailed);
      expect(err).toMatch(/refresh/i);
      expect(err).not.toContain('Not logged in');
      // Both escape hatches, asserted independently of the constant's wording.
      expect(err).toContain(`\`${formatWorkOSCommand('auth login')}\``);
      expect(err).toContain(`\`${formatWorkOSCommand('api')}\``);
    });

    it('adds the API-key caveat to the transient-failure copy when WORKOS_API_KEY is set', async () => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_x');
      saveCredentials(expiredCreds);
      mockRefreshAccessToken.mockResolvedValue({ success: false, errorType: 'network', error: 'Network error' });

      await expectAuthExit(requireCommandToken());

      expect(hasCredentials()).toBe(true);
      const err = consoleErrors.join('\n');
      expect(err).toContain(DASHBOARD_ERROR_MESSAGES.refreshFailedApiKeySet);
      expect(err).toContain('WORKOS_API_KEY');
      expect(err).toContain('does not accept API keys');
      expect(err).not.toContain('Not logged in');
    });

    it('exits 4 with both escape hatches when no credentials exist', async () => {
      await expectAuthExit(requireCommandToken());

      const err = consoleErrors.join('\n');
      expect(err).toContain(DASHBOARD_ERROR_MESSAGES.authRequired);
      // Asserted via the formatted commands, independent of the constant's wording.
      expect(err).toContain(`\`${formatWorkOSCommand('auth login')}\``);
      expect(err).toContain(`\`${formatWorkOSCommand('api')}\``);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
    });

    it('explains that API keys do not work here when WORKOS_API_KEY is set', async () => {
      vi.stubEnv('WORKOS_API_KEY', 'sk_test_x');

      await expectAuthExit(requireCommandToken());

      const err = consoleErrors.join('\n');
      expect(err).toContain(DASHBOARD_ERROR_MESSAGES.authRequiredApiKeySet);
      expect(err).toContain('WORKOS_API_KEY');
      expect(err).toContain('does not accept API keys');
      expect(err).toContain(`\`${formatWorkOSCommand('auth login')}\``);
      expect(err).toContain(`\`${formatWorkOSCommand('api')}\``);
    });
  });

  describe('DASHBOARD_ERROR_MESSAGES', () => {
    it('exposes plain strings through Object.entries (leak-gate contract)', () => {
      const entries = Object.entries(DASHBOARD_ERROR_MESSAGES);
      expect(entries.length).toBeGreaterThanOrEqual(4);
      for (const [key, message] of entries) {
        expect(typeof message, key).toBe('string');
        expect(message.length, key).toBeGreaterThan(0);
      }
    });

    it('every auth-required variant names both escape hatches', () => {
      const login = `\`${formatWorkOSCommand('auth login')}\``;
      const api = `\`${formatWorkOSCommand('api')}\``;
      for (const key of ['authRequired', 'authRequiredApiKeySet', 'refreshFailed', 'refreshFailedApiKeySet'] as const) {
        expect(DASHBOARD_ERROR_MESSAGES[key], key).toContain(login);
        expect(DASHBOARD_ERROR_MESSAGES[key], key).toContain(api);
      }
    });
  });
});
