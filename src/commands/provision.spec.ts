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

// Mock config-store
const mockGetConfig = vi.fn();
const mockSaveConfig = vi.fn();
vi.mock('../lib/config-store.js', () => ({
  getConfig: (...args: unknown[]) => mockGetConfig(...args),
  saveConfig: (...args: unknown[]) => mockSaveConfig(...args),
}));

// Mock mpp-client
const mockProvisionFree = vi.fn();
const mockRequestProduction = vi.fn();
const mockPollCheckoutStatus = vi.fn();
const mockProvisionWithCredential = vi.fn();

class MockMppClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'MppClientError';
  }
}

vi.mock('../lib/mpp-client.js', () => ({
  provisionFree: (...args: unknown[]) => mockProvisionFree(...args),
  requestProduction: (...args: unknown[]) => mockRequestProduction(...args),
  pollCheckoutStatus: (...args: unknown[]) => mockPollCheckoutStatus(...args),
  provisionWithCredential: (...args: unknown[]) => mockProvisionWithCredential(...args),
  MppClientError: MockMppClientError,
}));

const { runProvision } = await import('./provision.js');

const mockResult = {
  clientId: 'client_01ABC',
  apiKey: 'sk_test_key',
  authkitDomain: 'foo-bar.authkit.app',
  claimToken: 'ct_token_123',
  claimUrl: 'https://dashboard.workos.com/claim?nonce=abc',
  plan: 'free' as const,
};

describe('provision command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jsonMode = false;
    mockGetConfig.mockReturnValue({ environments: {} });
  });

  describe('free plan', () => {
    it('provisions directly and saves credentials', async () => {
      mockProvisionFree.mockResolvedValueOnce(mockResult);

      await runProvision('free');

      expect(mockProvisionFree).toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          activeEnvironment: 'unclaimed',
          environments: expect.objectContaining({
            unclaimed: expect.objectContaining({
              type: 'unclaimed',
              clientId: 'client_01ABC',
            }),
          }),
        }),
      );
      expect(mockClack.log.success).toHaveBeenCalledWith(expect.stringContaining('provisioned'));
    });

    it('outputs JSON in json mode', async () => {
      jsonMode = true;
      mockProvisionFree.mockResolvedValueOnce(mockResult);

      await runProvision('free');

      expect(mockOutputJson).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'provisioned',
          client_id: 'client_01ABC',
        }),
      );
    });

    it('exits with error on failure', async () => {
      mockProvisionFree.mockRejectedValueOnce(new MockMppClientError('Rate limited', 429));

      await runProvision('free').catch(() => {});

      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'provision_failed' }),
      );
    });
  });

  describe('production plan', () => {
    it('returns payment_required in JSON mode', async () => {
      jsonMode = true;
      mockRequestProduction.mockResolvedValueOnce({
        status: 'payment_required',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
        challengeId: 'challenge_123',
      });

      await runProvision('production');

      expect(mockOutputJson).toHaveBeenCalledWith({
        status: 'payment_required',
        checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        session_id: 'cs_test_abc',
      });
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it('opens browser and polls in TTY mode', async () => {
      mockRequestProduction.mockResolvedValueOnce({
        status: 'payment_required',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
        challengeId: 'challenge_123',
      });
      mockPollCheckoutStatus.mockResolvedValueOnce({ status: 'paid', credential: 'cs_test_abc' });
      mockProvisionWithCredential.mockResolvedValueOnce({ ...mockResult, plan: 'production' });

      await runProvision('production');

      expect(mockOpen).toHaveBeenCalledWith(
        'https://checkout.stripe.com/c/pay/cs_test_abc',
        { wait: false },
      );
      expect(mockSpinner.start).toHaveBeenCalledWith('Waiting for payment...');
      expect(mockSpinner.stop).toHaveBeenCalledWith('Payment complete!');
      expect(mockSaveConfig).toHaveBeenCalled();
    });

    it('handles payment failure', async () => {
      mockRequestProduction.mockResolvedValueOnce({
        status: 'payment_required',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
        challengeId: 'challenge_123',
      });
      mockPollCheckoutStatus.mockRejectedValueOnce(new MockMppClientError('Payment timed out.'));

      await runProvision('production').catch(() => {});

      expect(mockSpinner.stop).toHaveBeenCalledWith('Payment failed');
      expect(mockExitWithError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'payment_failed' }),
      );
    });

    it('handles direct success (no payment needed)', async () => {
      mockRequestProduction.mockResolvedValueOnce({ ...mockResult, plan: 'production' });

      await runProvision('production');

      expect(mockSaveConfig).toHaveBeenCalled();
      expect(mockClack.log.success).toHaveBeenCalledWith(expect.stringContaining('provisioned'));
    });

    it('shows fallback when browser open fails', async () => {
      mockRequestProduction.mockResolvedValueOnce({
        status: 'payment_required',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
        challengeId: 'challenge_123',
      });
      mockOpen.mockImplementationOnce(() => {
        throw new Error('No browser');
      });
      mockPollCheckoutStatus.mockResolvedValueOnce({ status: 'paid', credential: 'cs_test_abc' });
      mockProvisionWithCredential.mockResolvedValueOnce({ ...mockResult, plan: 'production' });

      await runProvision('production');

      expect(mockClack.log.info).toHaveBeenCalledWith(expect.stringContaining('Could not open browser'));
    });
  });
});
