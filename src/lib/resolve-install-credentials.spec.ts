import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config-store
const mockGetActiveEnvironment = vi.fn();
const mockIsUnclaimedEnvironment = vi.fn();
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
}));

// Mock credentials
const mockHasCredentials = vi.fn();
vi.mock('./credentials.js', () => ({
  hasCredentials: () => mockHasCredentials(),
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

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WORKOS_API_KEY;
  });

  afterEach(() => {
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

  it('returns without auth when active env has API key and OAuth credentials', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockHasCredentials.mockReturnValue(true);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it('authenticates when active env has API key but no gateway auth', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockHasCredentials.mockReturnValue(false);

    await resolveInstallCredentials(undefined, undefined, undefined, mockAuthenticate);

    expect(mockAuthenticate).toHaveBeenCalled();
  });

  it('skips auth when skipAuth is true and env has API key but no gateway auth', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      type: 'sandbox',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);
    mockHasCredentials.mockReturnValue(false);

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
});
