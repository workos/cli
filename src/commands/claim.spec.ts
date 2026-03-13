import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

// Mock opn (browser open)
const mockOpen = vi.fn().mockResolvedValue(undefined);
vi.mock('opn', () => ({ default: mockOpen }));

// Mock clack
const mockSpinner = {
  start: vi.fn(),
  stop: vi.fn(),
  message: vi.fn(),
};
const mockClack = {
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
  },
  spinner: () => mockSpinner,
};
vi.mock('../utils/clack.js', () => ({ default: mockClack }));

// Mock output utilities
const mockOutputJson = vi.fn();
let jsonMode = false;
const mockExitWithError = vi.fn(() => {
  throw new Error('exitWithError');
});
vi.mock('../utils/output.js', () => ({
  isJsonMode: () => jsonMode,
  outputJson: (...args: unknown[]) => mockOutputJson(...args),
  exitWithError: (...args: unknown[]) => mockExitWithError(...args),
}));

// Mock helper-functions
vi.mock('../lib/helper-functions.js', () => ({
  sleep: vi.fn((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
}));

// Mock config-store
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockGetActiveEnvironment = vi.fn();
const mockIsUnclaimedEnvironment = vi.fn();
const mockMarkEnvironmentClaimed = vi.fn();
vi.mock('../lib/config-store.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
  markEnvironmentClaimed: (...args: unknown[]) => mockMarkEnvironmentClaimed(...args),
}));

// Mock unclaimed-env-api
const mockCreateClaimNonce = vi.fn();
import { MockUnclaimedEnvApiError } from '../lib/__test-helpers__/mock-unclaimed-env-api-error.js';
vi.mock('../lib/unclaimed-env-api.js', () => ({
  createClaimNonce: (...args: unknown[]) => mockCreateClaimNonce(...args),
  UnclaimedEnvApiError: MockUnclaimedEnvApiError,
}));

const { runClaim } = await import('./claim.js');

describe('claim command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsonMode = false;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('runClaim', () => {
    it('exits with info when no active environment', async () => {
      mockGetActiveEnvironment.mockReturnValue(null);
      mockIsUnclaimedEnvironment.mockReturnValue(false);

      await runClaim();

      expect(mockClack.log.info).toHaveBeenCalledWith(expect.stringContaining('No unclaimed environment found'));
    });

    it('exits with info when active environment is not unclaimed', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'production',
        type: 'production',
        apiKey: 'sk_live_xxx',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(false);

      await runClaim();

      expect(mockClack.log.info).toHaveBeenCalledWith(expect.stringContaining('No unclaimed environment found'));
    });

    it('outputs JSON when no unclaimed environment in JSON mode', async () => {
      jsonMode = true;
      mockGetActiveEnvironment.mockReturnValue(null);
      mockIsUnclaimedEnvironment.mockReturnValue(false);

      await runClaim();

      expect(mockOutputJson).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_unclaimed_environment' }));
    });

    // Missing claimToken/clientId tests removed — discriminated union makes these states
    // impossible at the type level (UnclaimedEnvironmentConfig requires both fields).

    it('handles already-claimed environment immediately', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

      await runClaim();

      expect(mockClack.log.success).toHaveBeenCalledWith('Environment already claimed!');
      expect(mockMarkEnvironmentClaimed).toHaveBeenCalled();
    });

    it('generates nonce, opens browser, and polls for claim', async () => {
      const unclaimedEnv = {
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      };
      mockGetActiveEnvironment.mockReturnValue(unclaimedEnv);
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      // First call: returns nonce
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // Second call (poll): returns claimed
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

      const claimPromise = runClaim();

      // Advance past poll interval
      await vi.advanceTimersByTimeAsync(6_000);
      await claimPromise;

      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining('https://dashboard.workos.com/claim?nonce=nonce_abc123'),
        { wait: false },
      );
      expect(mockSpinner.start).toHaveBeenCalledWith('Waiting for claim...');
      expect(mockSpinner.stop).toHaveBeenCalledWith('Environment claimed!');
      expect(mockMarkEnvironmentClaimed).toHaveBeenCalled();
    });

    it('outputs JSON with claim URL in JSON mode', async () => {
      jsonMode = true;
      mockGetActiveEnvironment.mockReturnValue({
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });

      await runClaim();

      expect(mockOutputJson).toHaveBeenCalledWith({
        status: 'claim_url',
        claimUrl: 'https://dashboard.workos.com/claim?nonce=nonce_abc123',
        nonce: 'nonce_abc123',
      });
      // Should NOT open browser or start polling in JSON mode
      expect(mockOpen).not.toHaveBeenCalled();
      expect(mockSpinner.start).not.toHaveBeenCalled();
    });

    it('outputs JSON for already-claimed in JSON mode', async () => {
      jsonMode = true;
      mockGetActiveEnvironment.mockReturnValue({
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

      await runClaim();

      expect(mockOutputJson).toHaveBeenCalledWith(expect.objectContaining({ status: 'already_claimed' }));
    });

    it('times out after 5 minutes of polling', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      // First call: returns nonce
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // All poll calls: not yet claimed
      mockCreateClaimNonce.mockResolvedValue({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });

      const claimPromise = runClaim();

      // Advance past 5 minute timeout
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 5_000);
      await claimPromise;

      expect(mockSpinner.stop).toHaveBeenCalledWith('Claim timed out');
      expect(mockClack.log.info).toHaveBeenCalledWith(expect.stringContaining('Complete the claim in your browser'));
    });

    it('continues polling on transient poll errors', async () => {
      const unclaimedEnv = {
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      };
      mockGetActiveEnvironment.mockReturnValue(unclaimedEnv);
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      // First call: returns nonce
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // Second poll call: transient error
      mockCreateClaimNonce.mockRejectedValueOnce(new Error('Network blip'));
      // Third poll call: claimed
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

      const claimPromise = runClaim();

      // Advance through two poll intervals
      await vi.advanceTimersByTimeAsync(11_000);
      await claimPromise;

      expect(mockSpinner.stop).toHaveBeenCalledWith('Environment claimed!');
    });

    it('handles claim nonce generation failure', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockRejectedValueOnce(new Error('Invalid claim token.'));

      await runClaim().catch(() => {}); // exitWithError throws

      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'claim_failed', message: expect.stringContaining('Invalid claim token') }),
      );
    });

    it('treats 401 poll error as implicit claim (environment claimed externally)', async () => {
      const unclaimedEnv = {
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      };
      mockGetActiveEnvironment.mockReturnValue(unclaimedEnv);
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      // First call: returns nonce
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // Poll call: 401 — claim token invalidated (claimed via browser)
      mockCreateClaimNonce.mockRejectedValueOnce(new MockUnclaimedEnvApiError('Invalid claim token.', 401));

      const claimPromise = runClaim();
      await vi.advanceTimersByTimeAsync(6_000);
      await claimPromise;

      expect(mockSpinner.stop).toHaveBeenCalledWith('Claim token is invalid or expired.');
      expect(mockMarkEnvironmentClaimed).toHaveBeenCalled();
      expect(mockClack.log.warn).toHaveBeenCalledWith(expect.stringContaining('workos auth login'));
    });

    it('shows connection issues after 3 consecutive poll failures', async () => {
      const unclaimedEnv = {
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      };
      mockGetActiveEnvironment.mockReturnValue(unclaimedEnv);
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      // First call: returns nonce
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // 3 consecutive failures, then success
      mockCreateClaimNonce.mockRejectedValueOnce(new Error('Network error'));
      mockCreateClaimNonce.mockRejectedValueOnce(new Error('Network error'));
      mockCreateClaimNonce.mockRejectedValueOnce(new Error('Network error'));
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

      const claimPromise = runClaim();
      await vi.advanceTimersByTimeAsync(25_000);
      await claimPromise;

      expect(mockSpinner.message).toHaveBeenCalledWith('Still waiting... (connection issues detected)');
      expect(mockSpinner.stop).toHaveBeenCalledWith('Environment claimed!');
    });

    it('exits early after MAX_CONSECUTIVE_FAILURES poll errors', async () => {
      const unclaimedEnv = {
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      };
      mockGetActiveEnvironment.mockReturnValue(unclaimedEnv);
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      // First call: returns nonce
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // 10 consecutive failures (MAX_CONSECUTIVE_FAILURES)
      for (let i = 0; i < 10; i++) {
        mockCreateClaimNonce.mockRejectedValueOnce(new Error('Server down'));
      }

      const claimPromise = runClaim();
      await vi.advanceTimersByTimeAsync(60_000);
      await claimPromise;

      expect(mockSpinner.stop).toHaveBeenCalledWith('Too many connection failures');
      expect(mockClack.log.error).toHaveBeenCalledWith(expect.stringContaining('Polling failed 10 times'));
      expect(mockMarkEnvironmentClaimed).not.toHaveBeenCalled();
    });

    it('logs error and shows fallback when browser open fails', async () => {
      const unclaimedEnv = {
        name: 'unclaimed',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      };
      mockGetActiveEnvironment.mockReturnValue(unclaimedEnv);
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockResolvedValueOnce({
        nonce: 'nonce_abc123',
        alreadyClaimed: false,
      });
      // Poll returns claimed immediately
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });
      // Browser open throws synchronously (open() is called without await)
      mockOpen.mockImplementationOnce(() => {
        throw new Error('No browser available');
      });

      const claimPromise = runClaim();
      await vi.advanceTimersByTimeAsync(6_000);
      await claimPromise;

      expect(mockClack.log.info).toHaveBeenCalledWith(expect.stringContaining('Could not open browser'));
    });
  });
});
