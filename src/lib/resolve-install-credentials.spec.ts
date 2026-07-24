import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock config-store
const mockGetActiveEnvironment = vi.fn();
const mockIsUnclaimedEnvironment = vi.fn();
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
}));

// Mock credentials
const mockGetAccessToken = vi.fn();
vi.mock('./credentials.js', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

// Mock unclaimed-env-provision
const mockTryProvisionUnclaimedEnv = vi.fn();
vi.mock('./unclaimed-env-provision.js', () => ({
  tryProvisionUnclaimedEnv: (...args: unknown[]) => mockTryProvisionUnclaimedEnv(...args),
}));

const { resolveInstallCredentials } = await import('./resolve-install-credentials.js');

describe('resolveInstallCredentials', () => {
  const mockAuthenticate = vi.fn();
  const originalEnv = process.env.WORKOS_API_KEY;
  // The default install dir is process.cwd(), and credential resolution now
  // reads the project's env file. Point cwd at an empty dir so these specs
  // don't depend on whatever .env.local happens to sit in the repo root.
  let emptyCwd: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WORKOS_API_KEY;
    emptyCwd = mkdtempSync(join(tmpdir(), 'resolve-install-credentials-cwd-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(emptyCwd);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(emptyCwd, { recursive: true, force: true });
    if (originalEnv !== undefined) {
      process.env.WORKOS_API_KEY = originalEnv;
    } else {
      delete process.env.WORKOS_API_KEY;
    }
  });

  it('returns immediately when WORKOS_API_KEY env var is set', async () => {
    process.env.WORKOS_API_KEY = 'sk_test_env';

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockGetActiveEnvironment).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('returns immediately when apiKey argument is provided', async () => {
    await resolveInstallCredentials('sk_test_flag', undefined, undefined, mockAuthenticate);

    expect(mockGetActiveEnvironment).not.toHaveBeenCalled();
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('returns without auth when active env is unclaimed', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
  });

  it('returns without auth when active env has API key and a valid OAuth token', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockGetAccessToken.mockReturnValue('access_token');

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('authenticates when active env has API key but no valid gateway auth', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockGetAccessToken.mockReturnValue(null);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('skips auth when skipAuth is true and env has API key but no gateway auth', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockGetAccessToken.mockReturnValue(null);

    await resolveInstallCredentials(undefined, undefined, true, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('tries unclaimed provisioning when no active environment', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(true);

    await resolveInstallCredentials(undefined, '/test/dir', undefined, mockAuthenticate);

    expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: '/test/dir' });
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('falls back to auth when provisioning fails', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(false);

    await resolveInstallCredentials(undefined, '/test/dir', undefined, mockAuthenticate);

    expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalled();
    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('skips auth fallback when provisioning fails and skipAuth is true', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(false);

    await resolveInstallCredentials(undefined, undefined, true, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('uses process.cwd() when no installDir provided', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);
    mockTryProvisionUnclaimedEnv.mockResolvedValue(true);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: process.cwd() });
  });

  // Provisioning writes credentials into the project's env file. If a key is
  // already there, provisioning would clobber it — the reported data-loss bug.
  describe('project env file already has credentials', () => {
    let projectDir: string;

    beforeEach(() => {
      projectDir = mkdtempSync(join(tmpdir(), 'resolve-install-credentials-test-'));
      mockGetActiveEnvironment.mockReturnValue(null);
      mockTryProvisionUnclaimedEnv.mockResolvedValue(true);
    });

    afterEach(() => {
      rmSync(projectDir, { recursive: true, force: true });
    });

    it('skips provisioning and falls back to login when .env.local has WORKOS_API_KEY (JS project)', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'WORKOS_API_KEY=sk_a\nWORKOS_CLIENT_ID=client_a\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('skips provisioning when .env has WORKOS_API_KEY and there is no package.json (non-JS project)', async () => {
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_a\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).toHaveBeenCalled();
    });

    it('does not authenticate when skipAuth is set and the project env already has a key', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'WORKOS_API_KEY=sk_a\n');

      await resolveInstallCredentials(undefined, projectDir, true, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).not.toHaveBeenCalled();
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    it('provisions when .env.local exists but carries no WorkOS keys', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env.local'), 'DATABASE_URL=postgres://localhost/dev\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: projectDir });
      expect(mockAuthenticate).not.toHaveBeenCalled();
    });

    it('provisions when the project has no env file at all', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: projectDir });
    });

    // A JS project's .env is NOT the file the CLI would write, so it must not
    // suppress provisioning — the check has to mirror writeCredentialsEnv exactly.
    it('ignores a stale .env in a JS project (writeCredentialsEnv targets .env.local there)', async () => {
      writeFileSync(join(projectDir, 'package.json'), '{}');
      writeFileSync(join(projectDir, '.env'), 'WORKOS_API_KEY=sk_stale\n');

      await resolveInstallCredentials(undefined, projectDir, undefined, mockAuthenticate);

      expect(mockTryProvisionUnclaimedEnv).toHaveBeenCalledWith({ installDir: projectDir });
    });
  });
});
