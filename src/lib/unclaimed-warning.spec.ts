import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

// Mock output utilities
let jsonMode = false;
vi.mock('../utils/output.js', () => ({
  isJsonMode: () => jsonMode,
}));

// Mock config-store
const mockGetActiveEnvironment = vi.fn();
const mockIsUnclaimedEnvironment = vi.fn();
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

// Mock unclaimed-env-api
const mockCreateClaimNonce = vi.fn();
vi.mock('./unclaimed-env-api.js', () => ({
  createClaimNonce: (...args: unknown[]) => mockCreateClaimNonce(...args),
}));

// Mock claim command
const mockMarkEnvironmentClaimed = vi.fn();
vi.mock('../commands/claim.js', () => ({
  markEnvironmentClaimed: (...args: unknown[]) => mockMarkEnvironmentClaimed(...args),
}));

const { warnIfUnclaimed, resetUnclaimedWarningState } = await import('./unclaimed-warning.js');
const { logInfo } = await import('../utils/debug.js');

describe('unclaimed-warning', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonMode = false;
    resetUnclaimedWarningState();
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows warning when active env is unclaimed', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unclaimed environment'));
  });

  it('does not show warning when active env is not unclaimed', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'production',
      type: 'production',
      apiKey: 'sk_live_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);

    await warnIfUnclaimed();

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('does not show warning when no active env', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);

    await warnIfUnclaimed();

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows warning only once per session (dedup)', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();
    const callCount = stderrSpy.mock.calls.length;
    await warnIfUnclaimed();

    // Second call should not add any more output (dedup)
    expect(stderrSpy).toHaveBeenCalledTimes(callCount);
  });

  it('suppresses warning in JSON mode', async () => {
    jsonMode = true;
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('detects claimed status via lazy check and updates config', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);
    mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

    await warnIfUnclaimed();

    expect(mockMarkEnvironmentClaimed).toHaveBeenCalled();
    expect(logInfo).toHaveBeenCalledWith('[unclaimed-warning] Environment was claimed, config updated');
    // No warning shown when environment is claimed
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows warning when lazy check fails (network error)', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);
    mockCreateClaimNonce.mockRejectedValueOnce(new Error('Network error'));

    await warnIfUnclaimed();

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unclaimed environment'));
  });

  it('only does lazy check once per session', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);
    mockCreateClaimNonce.mockResolvedValue({ nonce: 'nonce_abc', alreadyClaimed: false });

    await warnIfUnclaimed();

    expect(mockCreateClaimNonce).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalled();

    const callCount = stderrSpy.mock.calls.length;
    // Second call — claim check should NOT fire again, warning should not re-show
    await warnIfUnclaimed();
    expect(mockCreateClaimNonce).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledTimes(callCount);
  });

  it('skips lazy check when no claimToken', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      // no claimToken
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();

    expect(mockCreateClaimNonce).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('skips lazy check when no clientId', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      claimToken: 'ct_token',
      // no clientId
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();

    expect(mockCreateClaimNonce).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('resetUnclaimedWarningState allows re-testing', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();
    const firstCallCount = stderrSpy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    resetUnclaimedWarningState();
    await warnIfUnclaimed();
    // Should have doubled the output (warning shown again after reset)
    expect(stderrSpy.mock.calls.length).toBe(firstCallCount * 2);
  });

  it('never throws even if getActiveEnvironment throws', async () => {
    mockGetActiveEnvironment.mockImplementation(() => {
      throw new Error('Config store failure');
    });

    // Should not throw
    await expect(warnIfUnclaimed()).resolves.toBeUndefined();
  });
});
