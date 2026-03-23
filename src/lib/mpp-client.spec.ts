import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

// Mock helper-functions — fast sleep for tests
vi.mock('./helper-functions.js', () => ({
  sleep: vi.fn((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
}));

const { provisionFree, requestProduction, pollCheckoutStatus, provisionWithCredential, MppClientError } = await import(
  './mpp-client.js'
);

const mockProvisionResponse = {
  client_id: 'client_01ABC',
  api_key: 'sk_test_key',
  authkit_domain: 'foo-bar.authkit.app',
  claim_token: 'ct_token_123',
  claim_url: 'https://dashboard.workos.com/claim?nonce=abc',
};

const mock402Response = {
  type: 'https://paymentauth.org/problems/payment-required',
  title: 'Payment Required',
  status: 402,
  checkout_url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
  session_id: 'cs_test_abc',
  challengeId: 'challenge_123',
};

describe('mpp-client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('provisionFree', () => {
    it('returns credentials on 200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(mockProvisionResponse), { status: 200 })),
      );

      const result = await provisionFree();

      expect(result.clientId).toBe('client_01ABC');
      expect(result.apiKey).toBe('sk_test_key');
      expect(result.authkitDomain).toBe('foo-bar.authkit.app');
      expect(result.plan).toBe('free');
    });

    it('throws on 429 rate limit', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Rate Limited', { status: 429 })));

      await expect(provisionFree()).rejects.toThrow('Rate limited');
    });

    it('throws on 502 server error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Error', { status: 502 })));

      await expect(provisionFree()).rejects.toThrow('Server error: 502');
    });

    it('throws on network timeout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );

      await expect(provisionFree()).rejects.toThrow('timed out');
    });
  });

  describe('requestProduction', () => {
    it('returns MppPaymentRequired on 402 with checkout_url', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(mock402Response), { status: 402 })),
      );

      const result = await requestProduction();

      expect(result).toEqual({
        status: 'payment_required',
        checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        sessionId: 'cs_test_abc',
        challengeId: 'challenge_123',
      });
    });

    it('throws when 402 has no checkout_url', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 402 }), { status: 402 }),
        ),
      );

      await expect(requestProduction()).rejects.toThrow('did not return a checkout URL');
    });

    it('throws on 429 rate limit', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Rate Limited', { status: 429 })));

      await expect(requestProduction()).rejects.toThrow('Rate limited');
    });

    it('throws on 502 server error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Error', { status: 502 })));

      await expect(requestProduction()).rejects.toThrow('Server error: 502');
    });

    it('returns credentials directly if payment not needed', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(mockProvisionResponse), { status: 200 })),
      );

      const result = await requestProduction();

      expect(result).toHaveProperty('clientId', 'client_01ABC');
      expect(result).toHaveProperty('plan', 'production');
    });

    it('throws on 200 response with missing required fields', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'partial' }), { status: 200 })),
      );

      await expect(requestProduction()).rejects.toThrow('missing required fields');
    });
  });

  describe('pollCheckoutStatus', () => {
    it('polls pending then returns paid', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ status: 'pending', session_id: 'cs_test_abc' }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 'paid', session_id: 'cs_test_abc', credential: 'cs_test_abc' }),
            { status: 200 },
          ),
        );
      vi.stubGlobal('fetch', mockFetch);

      const onPoll = vi.fn();
      const pollPromise = pollCheckoutStatus('cs_test_abc', onPoll);

      await vi.advanceTimersByTimeAsync(7_000);
      const result = await pollPromise;

      expect(result.status).toBe('paid');
      expect(result.credential).toBe('cs_test_abc');
      expect(onPoll).toHaveBeenCalledWith('pending');
      expect(onPoll).toHaveBeenCalledWith('paid');
    });

    it('throws on expired session (410)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ status: 'expired' }), { status: 410 })),
      );

      let caughtError: Error | undefined;
      const pollPromise = pollCheckoutStatus('cs_test_abc').catch((e: Error) => {
        caughtError = e;
      });

      await vi.advanceTimersByTimeAsync(4_000);
      await pollPromise;

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain('cancelled or session expired');
    });

    it('throws on timeout after 5 minutes', async () => {
      // Always return pending — must create new Response each call (body can only be read once)
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ status: 'pending', session_id: 'cs_test_abc' }), { status: 200 })),
        ),
      );

      let caughtError: Error | undefined;
      const pollPromise = pollCheckoutStatus('cs_test_abc').catch((e: Error) => {
        caughtError = e;
      });

      // Advance past the 5 minute timeout
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 5_000);
      await pollPromise;

      expect(caughtError).toBeDefined();
      expect(caughtError!.message).toContain('timed out');
    });

    it('continues polling on transient errors', async () => {
      const mockFetch = vi
        .fn()
        // First poll: transient 500 error
        .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
        // Second poll: paid
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ status: 'paid', session_id: 'cs_test_abc', credential: 'cs_test_abc' }),
            { status: 200 },
          ),
        );
      vi.stubGlobal('fetch', mockFetch);

      const onPoll = vi.fn();
      const pollPromise = pollCheckoutStatus('cs_test_abc', onPoll);

      await vi.advanceTimersByTimeAsync(7_000);
      const result = await pollPromise;

      expect(result.status).toBe('paid');
      expect(onPoll).toHaveBeenCalledWith('error');
      expect(onPoll).toHaveBeenCalledWith('paid');
    });
  });

  describe('provisionWithCredential', () => {
    it('returns credentials with X-Checkout-Session header', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(new Response(JSON.stringify(mockProvisionResponse), { status: 200 }));
      vi.stubGlobal('fetch', mockFetch);

      const result = await provisionWithCredential('cs_test_abc');

      expect(result.clientId).toBe('client_01ABC');
      expect(result.plan).toBe('production');
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/provision/production'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'X-Checkout-Session': 'cs_test_abc' },
        }),
      );
    });

    it('throws on 402 (payment not complete)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'payment_not_complete' }), { status: 402 }),
        ),
      );

      await expect(provisionWithCredential('cs_test_abc')).rejects.toThrow('could not be verified');
    });

    it('throws on 429 rate limit', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('Rate Limited', { status: 429 })));

      await expect(provisionWithCredential('cs_test_abc')).rejects.toThrow('Rate limited');
    });

    it('throws on network timeout', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' })),
      );

      await expect(provisionWithCredential('cs_test_abc')).rejects.toThrow('timed out');
    });
  });
});
