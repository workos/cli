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
const mockMarkEnvironmentClaimed = vi.fn();
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
  markEnvironmentClaimed: (...args: unknown[]) => mockMarkEnvironmentClaimed(...args),
}));

// Mock unclaimed-env-api
const mockCreateClaimNonce = vi.fn();
import { MockUnclaimedEnvApiError } from './__test-helpers__/mock-unclaimed-env-api-error.js';
vi.mock('./unclaimed-env-api.js', () => ({
  createClaimNonce: (...args: unknown[]) => mockCreateClaimNonce(...args),
  UnclaimedEnvApiError: MockUnclaimedEnvApiError,
}));

// Mock box utility
const mockRenderStderrBox = vi.fn();
vi.mock('../utils/box.js', () => ({
  renderStderrBox: (...args: unknown[]) => mockRenderStderrBox(...args),
}));

const { warnIfUnclaimed, resetUnclaimedWarningState } = await import('./unclaimed-warning.js');

describe('unclaimed-warning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsonMode = false;
    resetUnclaimedWarningState();
  });

  it('shows warning when active env is unclaimed', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();

    expect(mockRenderStderrBox).toHaveBeenCalled();
  });

  it('does not show warning when active env is not unclaimed', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'production',
      type: 'production',
      apiKey: 'sk_live_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(false);

    await warnIfUnclaimed();

    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('does not show warning when no active env', async () => {
    mockGetActiveEnvironment.mockReturnValue(null);

    await warnIfUnclaimed();

    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('shows warning only once per session (dedup)', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);
    await warnIfUnclaimed();

    // Second call should not add any more output (dedup)
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);
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

    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('resetUnclaimedWarningState allows re-testing', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);

    await warnIfUnclaimed();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);

    resetUnclaimedWarningState();
    await warnIfUnclaimed();
    // Should have doubled the output (warning shown again after reset)
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(2);
  });

  it('detects claimed status and updates config', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);
    mockCreateClaimNonce.mockResolvedValue({ alreadyClaimed: true });

    await warnIfUnclaimed();

    expect(mockMarkEnvironmentClaimed).toHaveBeenCalled();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('shows warning when claim check fails', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);
    mockCreateClaimNonce.mockRejectedValue(new Error('Network error'));

    await warnIfUnclaimed();

    expect(mockRenderStderrBox).toHaveBeenCalled();
  });

  it('promotes to claimed when claim check returns 401', async () => {
    mockGetActiveEnvironment.mockReturnValue({
      name: 'unclaimed',
      type: 'unclaimed',
      apiKey: 'sk_test_xxx',
      clientId: 'client_01ABC',
      claimToken: 'ct_token',
    });
    mockIsUnclaimedEnvironment.mockReturnValue(true);
    mockCreateClaimNonce.mockRejectedValue(new MockUnclaimedEnvApiError('Invalid claim token.', 401));

    await warnIfUnclaimed();

    expect(mockMarkEnvironmentClaimed).toHaveBeenCalled();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('never throws even if getActiveEnvironment throws', async () => {
    mockGetActiveEnvironment.mockImplementation(() => {
      throw new Error('Config store failure');
    });

    // Should not throw
    await expect(warnIfUnclaimed()).resolves.toBeUndefined();
  });
});
