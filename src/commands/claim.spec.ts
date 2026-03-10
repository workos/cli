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
vi.mock('../utils/output.js', () => ({
  isJsonMode: () => jsonMode,
  outputJson: (...args: unknown[]) => mockOutputJson(...args),
}));

// Mock config-store
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
const mockGetActiveEnvironment = vi.fn();
const mockIsUnclaimedEnvironment = vi.fn();
vi.mock('../lib/config-store.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
  isUnclaimedEnvironment: (...args: unknown[]) => mockIsUnclaimedEnvironment(...args),
}));

// Mock one-shot-api
const mockCreateClaimNonce = vi.fn();
vi.mock('../lib/one-shot-api.js', () => ({
  createClaimNonce: (...args: unknown[]) => mockCreateClaimNonce(...args),
}));

const { runClaim, markEnvironmentClaimed } = await import('./claim.js');

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

      expect(mockClack.log.info).toHaveBeenCalledWith(
        expect.stringContaining('No unclaimed environment found'),
      );
    });

    it('exits with info when active environment is not unclaimed', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'production',
        type: 'production',
        apiKey: 'sk_live_xxx',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(false);

      await runClaim();

      expect(mockClack.log.info).toHaveBeenCalledWith(
        expect.stringContaining('No unclaimed environment found'),
      );
    });

    it('outputs JSON when no unclaimed environment in JSON mode', async () => {
      jsonMode = true;
      mockGetActiveEnvironment.mockReturnValue(null);
      mockIsUnclaimedEnvironment.mockReturnValue(false);

      await runClaim();

      expect(mockOutputJson).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'no_unclaimed_environment' }),
      );
    });

    it('exits with error when missing claim token', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'one-shot',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        // no claimToken
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      await runClaim();

      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Missing claim token'),
      );
    });

    it('exits with error when missing clientId', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'one-shot',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        claimToken: 'ct_token',
        // no clientId
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);

      await runClaim();

      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Missing claim token or client ID'),
      );
    });

    it('handles already-claimed environment immediately', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'one-shot',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });

      // Mock getConfig for markEnvironmentClaimed
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'one-shot',
        environments: {
          'one-shot': {
            name: 'one-shot',
            type: 'unclaimed',
            apiKey: 'sk_test_xxx',
            clientId: 'client_01ABC',
            claimToken: 'ct_token',
          },
        },
      });

      await runClaim();

      expect(mockClack.log.success).toHaveBeenCalledWith('Environment already claimed!');
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          environments: expect.objectContaining({
            'one-shot': expect.objectContaining({ type: 'sandbox' }),
          }),
        }),
      );
    });

    it('generates nonce, opens browser, and polls for claim', async () => {
      const unclaimedEnv = {
        name: 'one-shot',
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

      // Mock getConfig for markEnvironmentClaimed
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'one-shot',
        environments: { 'one-shot': { ...unclaimedEnv } },
      });

      const claimPromise = runClaim();

      // Advance past poll interval
      await vi.advanceTimersByTimeAsync(6_000);
      await claimPromise;

      expect(mockOpen).toHaveBeenCalledWith(
        expect.stringContaining('https://dashboard.workos.com/claim?nonce=nonce_abc123'),
      );
      expect(mockSpinner.start).toHaveBeenCalledWith('Waiting for claim...');
      expect(mockSpinner.stop).toHaveBeenCalledWith('Environment claimed!');
      expect(mockSaveConfig).toHaveBeenCalled();
    });

    it('outputs JSON with claim URL in JSON mode', async () => {
      jsonMode = true;
      mockGetActiveEnvironment.mockReturnValue({
        name: 'one-shot',
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
        name: 'one-shot',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockResolvedValueOnce({ alreadyClaimed: true });
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'one-shot',
        environments: {
          'one-shot': {
            name: 'one-shot',
            type: 'unclaimed',
            apiKey: 'sk_test_xxx',
            clientId: 'client_01ABC',
            claimToken: 'ct_token',
          },
        },
      });

      await runClaim();

      expect(mockOutputJson).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'already_claimed' }),
      );
    });

    it('times out after 5 minutes of polling', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'one-shot',
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
      expect(mockClack.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Complete the claim in your browser'),
      );
    });

    it('continues polling on transient poll errors', async () => {
      const unclaimedEnv = {
        name: 'one-shot',
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

      mockGetConfig.mockReturnValue({
        activeEnvironment: 'one-shot',
        environments: { 'one-shot': { ...unclaimedEnv } },
      });

      const claimPromise = runClaim();

      // Advance through two poll intervals
      await vi.advanceTimersByTimeAsync(11_000);
      await claimPromise;

      expect(mockSpinner.stop).toHaveBeenCalledWith('Environment claimed!');
    });

    it('handles claim nonce generation failure', async () => {
      mockGetActiveEnvironment.mockReturnValue({
        name: 'one-shot',
        type: 'unclaimed',
        apiKey: 'sk_test_xxx',
        clientId: 'client_01ABC',
        claimToken: 'ct_token',
      });
      mockIsUnclaimedEnvironment.mockReturnValue(true);
      mockCreateClaimNonce.mockRejectedValueOnce(new Error('Invalid claim token.'));

      await runClaim();

      expect(mockClack.log.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid claim token'),
      );
      expect(mockClack.log.info).toHaveBeenCalledWith(
        expect.stringContaining('Try again'),
      );
    });
  });

  describe('markEnvironmentClaimed', () => {
    it('updates environment type to sandbox and removes claimToken', () => {
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'one-shot',
        environments: {
          'one-shot': {
            name: 'one-shot',
            type: 'unclaimed',
            apiKey: 'sk_test_xxx',
            clientId: 'client_01ABC',
            claimToken: 'ct_token',
          },
        },
      });

      markEnvironmentClaimed();

      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          environments: expect.objectContaining({
            'one-shot': expect.objectContaining({
              type: 'sandbox',
            }),
          }),
        }),
      );
      // Verify claimToken is removed
      const savedConfig = mockSaveConfig.mock.calls[0][0];
      expect(savedConfig.environments['one-shot'].claimToken).toBeUndefined();
    });

    it('does nothing when no config', () => {
      mockGetConfig.mockReturnValue(null);

      markEnvironmentClaimed();

      expect(mockSaveConfig).not.toHaveBeenCalled();
    });

    it('does nothing when no active environment', () => {
      mockGetConfig.mockReturnValue({
        environments: { 'one-shot': { name: 'one-shot', type: 'unclaimed', apiKey: 'sk_test' } },
      });

      markEnvironmentClaimed();

      expect(mockSaveConfig).not.toHaveBeenCalled();
    });
  });
});
