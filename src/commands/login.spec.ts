import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const mockOpen = vi.fn();
vi.mock('open', () => ({ default: (...args: unknown[]) => mockOpen(...args) }));

class MockDeviceAuthTimeoutError extends Error {}
const mockRequestDeviceCode = vi.fn();
const mockPollForToken = vi.fn();
vi.mock('../lib/device-auth.js', () => ({
  requestDeviceCode: (...args: unknown[]) => mockRequestDeviceCode(...args),
  pollForToken: (...args: unknown[]) => mockPollForToken(...args),
  DeviceAuthTimeoutError: MockDeviceAuthTimeoutError,
}));

const mockExitWithAuthRequired = vi.fn(() => {
  throw new Error('auth_required');
});
vi.mock('../utils/exit-codes.js', () => ({
  exitWithAuthRequired: (...args: unknown[]) => mockExitWithAuthRequired(...args),
}));

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

// Mock skill install + JSON mode — installSkillsAfterLogin tests drive both.
vi.mock('./install-skill.js', () => ({
  autoInstallSkills: vi.fn(),
}));

vi.mock('../utils/output.js', () => ({
  isJsonMode: vi.fn(() => false),
  exitWithError: vi.fn(),
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
const { provisionStagingEnvironment, installSkillsAfterLogin, runLogin } = await import('./login.js');
const { autoInstallSkills } = await import('./install-skill.js');
const { isJsonMode } = await import('../utils/output.js');
const { clearCredentials, setInsecureStorage } = await import('../lib/credentials.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');
const clackMod = await import('../utils/clack.js');

describe('login', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'login-test-'));
    setInsecureConfigStorage(true);
    setInsecureStorage(true);
    resetInteractionModeForTests();
    clearCredentials();
    vi.clearAllMocks();
    mockOpen.mockResolvedValue({});
    mockRequestDeviceCode.mockResolvedValue({
      verification_uri: 'https://auth.example.com/device',
      verification_uri_complete: 'https://auth.example.com/device?code=ABCD',
      user_code: 'ABCD-EFGH',
      device_code: 'device_123',
      interval: 1,
    });
    mockPollForToken.mockResolvedValue({
      accessToken: 'access_token',
      expiresAt: Date.now() + 3600000,
      userId: 'user_123',
      email: 'user@example.com',
      refreshToken: 'refresh_token',
    });
  });

  afterEach(() => {
    clearCredentials();
    clearConfig();
    resetInteractionModeForTests();
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

  describe('runLogin', () => {
    it('refuses browser/device auth in CI mode', async () => {
      setInteractionMode({ mode: 'ci', source: 'env' });

      await expect(runLogin()).rejects.toThrow('auth_required');

      expect(mockExitWithAuthRequired).toHaveBeenCalledWith(expect.stringContaining('CI mode'));
      expect(mockRequestDeviceCode).not.toHaveBeenCalled();
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it('prints manual fallback and attempts browser launch in agent mode', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      const infoSpy = vi.mocked(clackMod.default.log.info);

      await runLogin();

      expect(mockRequestDeviceCode).toHaveBeenCalledOnce();
      expect(mockOpen).toHaveBeenCalledWith('https://auth.example.com/device?code=ABCD', { wait: false });
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('manual URL'));
    });
  });

  describe('installSkillsAfterLogin', () => {
    it('invokes autoInstallSkills', async () => {
      vi.mocked(autoInstallSkills).mockResolvedValueOnce(null);

      await installSkillsAfterLogin();

      expect(autoInstallSkills).toHaveBeenCalledOnce();
    });

    it('returns without throwing when autoInstallSkills rejects', async () => {
      vi.mocked(autoInstallSkills).mockRejectedValueOnce(new Error('install boom'));

      // The whole point of the helper: login must keep its success even when
      // skill install fails. Asserting no rejection IS the test.
      await expect(installSkillsAfterLogin()).resolves.toBeUndefined();
    });

    it('logs a one-line success message in human mode', async () => {
      vi.mocked(autoInstallSkills).mockResolvedValueOnce({
        skills: ['workos', 'workos-widgets'],
        agents: ['Claude Code', 'Codex'],
        version: '0.4.0',
      });

      const infoSpy = vi.mocked(clackMod.default.log.info);
      infoSpy.mockClear();

      await installSkillsAfterLogin();

      expect(infoSpy).toHaveBeenCalledOnce();
      const message = infoSpy.mock.calls[0]?.[0] as string;
      expect(message).toContain('2 WorkOS skills');
      expect(message).toContain('Claude Code');
      expect(message).toContain('Codex');
    });

    it('uses singular "skill" when exactly one skill installed', async () => {
      vi.mocked(autoInstallSkills).mockResolvedValueOnce({
        skills: ['workos'],
        agents: ['Claude Code'],
        version: '0.4.0',
      });

      const infoSpy = vi.mocked(clackMod.default.log.info);
      infoSpy.mockClear();

      await installSkillsAfterLogin();

      const message = infoSpy.mock.calls[0]?.[0] as string;
      expect(message).toContain('1 WorkOS skill ');
      expect(message).not.toContain('1 WorkOS skills');
    });

    it('skips logging in JSON mode', async () => {
      vi.mocked(isJsonMode).mockReturnValueOnce(true);
      vi.mocked(autoInstallSkills).mockResolvedValueOnce({
        skills: ['workos'],
        agents: ['Claude Code'],
        version: '0.4.0',
      });

      const infoSpy = vi.mocked(clackMod.default.log.info);
      infoSpy.mockClear();

      await installSkillsAfterLogin();

      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('skips logging when autoInstallSkills returns null', async () => {
      vi.mocked(autoInstallSkills).mockResolvedValueOnce(null);

      const infoSpy = vi.mocked(clackMod.default.log.info);
      infoSpy.mockClear();

      await installSkillsAfterLogin();

      expect(infoSpy).not.toHaveBeenCalled();
    });
  });
});
