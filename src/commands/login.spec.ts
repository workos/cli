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
      warn: vi.fn(),
    },
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
    })),
    confirm: vi.fn(),
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
  outputJson: vi.fn(),
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

const { getConfig, saveConfig, setInsecureConfigStorage, clearConfig } = await import('../lib/config-store.js');
const { provisionStagingEnvironment, installSkillsAfterLogin, runLogin } = await import('./login.js');
const { autoInstallSkills } = await import('./install-skill.js');
const { isJsonMode, outputJson } = await import('../utils/output.js');
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

      const result = await provisionStagingEnvironment('access_token_xyz', { userId: 'u1', email: 'a@example.com' });

      expect(result.provisioned).toBe(true);
      expect(mockFetchStagingCredentials).toHaveBeenCalledWith('access_token_xyz');

      const config = getConfig();
      expect(config).not.toBeNull();
      expect(config?.environments['staging']).toMatchObject({
        name: 'staging',
        type: 'sandbox',
        apiKey: 'sk_test_staging_abc',
        clientId: 'client_staging_123',
        ownerEmail: 'a@example.com',
        ownerUserId: 'u1',
      });
    });

    it('sets staging as active environment when no environments exist', async () => {
      mockFetchStagingCredentials.mockResolvedValueOnce({
        clientId: 'client_123',
        apiKey: 'sk_test_abc',
      });

      await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

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

      await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

      const config = getConfig();
      expect(config?.activeEnvironment).toBe('production');
      expect(config?.environments['staging']).toBeDefined();
      expect(config?.environments['production']).toBeDefined();
    });

    it('updates existing staging environment in place on re-login as the same account', async () => {
      // Same account (email match) — even a reissued clientId updates in place,
      // never spawning a staging-2. ownerEmail is what identifies "same account".
      saveConfig({
        activeEnvironment: 'staging',
        environments: {
          staging: {
            name: 'staging',
            type: 'sandbox',
            apiKey: 'sk_test_old',
            clientId: 'client_old',
            ownerEmail: 'a@example.com',
            ownerUserId: 'u1',
          },
        },
      });

      mockFetchStagingCredentials.mockResolvedValueOnce({
        clientId: 'client_new',
        apiKey: 'sk_test_new',
      });

      const result = await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

      expect(result.provisioned).toBe(true);
      expect(result.mismatch).toBe(false);
      const config = getConfig();
      expect(config?.environments['staging-2']).toBeUndefined();
      expect(config?.environments['staging']?.apiKey).toBe('sk_test_new');
      expect(config?.environments['staging']?.clientId).toBe('client_new');
      expect(config?.environments['staging']?.ownerEmail).toBe('a@example.com');
      expect(config?.environments['staging']?.ownerUserId).toBe('u1');
    });

    it('returns not-provisioned and does not throw on API 403 error', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('Access denied'));

      const result = await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

      expect(result.provisioned).toBe(false);
      const config = getConfig();
      expect(config).toBeNull();
    });

    it('returns not-provisioned and does not throw on API 404 error', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('No staging environment found'));

      const result = await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

      expect(result.provisioned).toBe(false);
    });

    it('returns not-provisioned and does not throw on network error', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('Network error'));

      const result = await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

      expect(result.provisioned).toBe(false);
    });

    it('returns not-provisioned and does not throw on timeout', async () => {
      mockFetchStagingCredentials.mockRejectedValueOnce(new Error('Request timed out'));

      const result = await provisionStagingEnvironment('token', { userId: 'u1', email: 'a@example.com' });

      expect(result.provisioned).toBe(false);
    });
  });

  describe('provisionStagingEnvironment mismatch', () => {
    it('stamps ownerEmail and ownerUserId on the provisioned env', async () => {
      mockFetchStagingCredentials.mockResolvedValueOnce({ clientId: 'client_gmail', apiKey: 'sk_test' });

      await provisionStagingEnvironment('token', { email: 'g@x.com', userId: 'u1' });

      const config = getConfig();
      expect(config?.environments['staging']?.ownerEmail).toBe('g@x.com');
      expect(config?.environments['staging']?.ownerUserId).toBe('u1');
    });

    it('adds a second staging env without repointing when the active claimed env is a different account', async () => {
      saveConfig({
        activeEnvironment: 'sandbox',
        environments: {
          sandbox: { name: 'sandbox', type: 'sandbox', apiKey: 'sk', clientId: 'client_akshay' },
        },
      });
      mockFetchStagingCredentials.mockResolvedValueOnce({ clientId: 'client_gmail', apiKey: 'sk_test' });

      const result = await provisionStagingEnvironment('token', { email: 'g@x.com', userId: 'u1' });

      expect(result.mismatch).toBe(true);
      const config = getConfig();
      expect(config?.activeEnvironment).toBe('sandbox'); // preserved
      expect(config?.environments['staging']?.clientId).toBe('client_gmail');
    });

    it('never clobbers a different account already in the staging slot (in-place-clobber guard)', async () => {
      saveConfig({
        activeEnvironment: 'staging',
        environments: {
          staging: {
            name: 'staging',
            type: 'sandbox',
            apiKey: 'sk',
            clientId: 'client_akshay',
            ownerEmail: 'akshay@x.com',
          },
        },
      });
      mockFetchStagingCredentials.mockResolvedValueOnce({ clientId: 'client_gmail', apiKey: 'sk_test' });

      const result = await provisionStagingEnvironment('token', { email: 'g@x.com', userId: 'u1' });

      const config = getConfig();
      // The original staging slot is untouched — pre-fix code overwrote it here.
      expect(config?.environments['staging']?.clientId).toBe('client_akshay');
      expect(config?.environments['staging-2']?.clientId).toBe('client_gmail');
      expect(config?.activeEnvironment).toBe('staging');
      expect(result.mismatch).toBe(true);
      expect(result.envName).toBe('staging-2');
    });

    it('updates in place with no mismatch when the same account logs in again', async () => {
      saveConfig({
        activeEnvironment: 'staging',
        environments: {
          staging: {
            name: 'staging',
            type: 'sandbox',
            apiKey: 'sk_old',
            clientId: 'client_gmail',
            ownerEmail: 'g@x.com',
          },
        },
      });
      mockFetchStagingCredentials.mockResolvedValueOnce({ clientId: 'client_gmail', apiKey: 'sk_new' });

      const result = await provisionStagingEnvironment('token', { email: 'g@x.com', userId: 'u1' });

      expect(result.mismatch).toBe(false);
      const config = getConfig();
      expect(config?.environments['staging-2']).toBeUndefined();
      expect(config?.environments['staging']?.apiKey).toBe('sk_new');
      expect(config?.activeEnvironment).toBe('staging');
    });

    it('auto-assigns active on first login onto an empty config', async () => {
      mockFetchStagingCredentials.mockResolvedValueOnce({ clientId: 'client_gmail', apiKey: 'sk_test' });

      const result = await provisionStagingEnvironment('token', { email: 'g@x.com', userId: 'u1' });

      const config = getConfig();
      expect(config?.activeEnvironment).toBe('staging');
      expect(config?.environments['staging']?.ownerEmail).toBe('g@x.com');
      expect(result.mismatch).toBe(false);
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

    it('prints a "Now using" line naming the account in human mode', async () => {
      setInteractionMode({ mode: 'human', source: 'env' });
      mockFetchStagingCredentials.mockResolvedValue({ clientId: 'client_user', apiKey: 'sk_test_user' });

      await runLogin();

      const successSpy = vi.mocked(clackMod.default.log.success);
      const nowUsing = successSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('Now using'));
      expect(nowUsing).toBeDefined();
      expect(nowUsing).toContain('user@example.com');
    });

    it('switches the active env when the user confirms on a cross-account login', async () => {
      setInteractionMode({ mode: 'human', source: 'env' });
      saveConfig({
        activeEnvironment: 'sandbox',
        environments: { sandbox: { name: 'sandbox', type: 'sandbox', apiKey: 'sk', clientId: 'client_other' } },
      });
      mockFetchStagingCredentials.mockResolvedValue({ clientId: 'client_user', apiKey: 'sk_test_user' });
      vi.mocked(clackMod.default.confirm).mockResolvedValueOnce(true);

      await runLogin();

      expect(getConfig()?.activeEnvironment).toBe('staging');
    });

    it('keeps the prior active env when the user declines the switch', async () => {
      setInteractionMode({ mode: 'human', source: 'env' });
      saveConfig({
        activeEnvironment: 'sandbox',
        environments: { sandbox: { name: 'sandbox', type: 'sandbox', apiKey: 'sk', clientId: 'client_other' } },
      });
      mockFetchStagingCredentials.mockResolvedValue({ clientId: 'client_user', apiKey: 'sk_test_user' });
      vi.mocked(clackMod.default.confirm).mockResolvedValueOnce(false);

      await runLogin();

      expect(getConfig()?.activeEnvironment).toBe('sandbox');
    });

    it('warns and never prompts on a cross-account login in agent mode', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      saveConfig({
        activeEnvironment: 'sandbox',
        environments: { sandbox: { name: 'sandbox', type: 'sandbox', apiKey: 'sk', clientId: 'client_other' } },
      });
      mockFetchStagingCredentials.mockResolvedValue({ clientId: 'client_user', apiKey: 'sk_test_user' });

      await runLogin();

      expect(clackMod.default.confirm).not.toHaveBeenCalled();
      expect(getConfig()?.activeEnvironment).toBe('sandbox');
      const warned = vi
        .mocked(clackMod.default.log.warn)
        .mock.calls.map((c) => String(c[0]))
        .join('\n');
      expect(warned).toContain('sandbox');
      expect(warned).toContain('user@example.com');
    });

    it('emits structured provisioning fields and never prompts in JSON mode', async () => {
      vi.mocked(isJsonMode).mockReturnValueOnce(true);
      saveConfig({
        activeEnvironment: 'sandbox',
        environments: { sandbox: { name: 'sandbox', type: 'sandbox', apiKey: 'sk', clientId: 'client_other' } },
      });
      mockFetchStagingCredentials.mockResolvedValue({ clientId: 'client_user', apiKey: 'sk_test_user' });

      await runLogin();

      expect(clackMod.default.confirm).not.toHaveBeenCalled();
      expect(outputJson).toHaveBeenCalledWith(
        expect.objectContaining({
          mismatch: true,
          activeEnvironment: 'sandbox',
          account: expect.objectContaining({ email: 'user@example.com' }),
        }),
      );
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
