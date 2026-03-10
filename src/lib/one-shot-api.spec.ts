import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('./config-store.js', () => ({
  getActiveEnvironment: vi.fn(() => null),
}));

const { provisionOneShotEnvironment, createClaimNonce, generateCookiePassword, OneShotApiError } = await import(
  './one-shot-api.js'
);
const { getActiveEnvironment } = await import('./config-store.js');

describe('one-shot-api', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
    vi.mocked(getActiveEnvironment).mockReturnValue(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('provisionOneShotEnvironment', () => {
    const validResponse = {
      clientId: 'client_01ABC',
      apiKey: 'sk_test_xyz',
      claimToken: 'ct_token123',
      authkitDomain: 'auth.example.com',
    };

    it('returns all 4 fields on success (camelCase)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validResponse,
      });

      const result = await provisionOneShotEnvironment();

      expect(result).toEqual(validResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.workos.com/x/one-shot-environments',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    it('handles snake_case response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          client_id: 'client_456',
          api_key: 'sk_test_def',
          claim_token: 'ct_snake',
          authkit_domain: 'auth.snake.com',
        }),
      });

      const result = await provisionOneShotEnvironment();

      expect(result).toEqual({
        clientId: 'client_456',
        apiKey: 'sk_test_def',
        claimToken: 'ct_snake',
        authkitDomain: 'auth.snake.com',
      });
    });

    it('prefers camelCase over snake_case when both present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientId: 'camel_client',
          apiKey: 'camel_key',
          claimToken: 'camel_token',
          authkitDomain: 'camel.domain',
          client_id: 'snake_client',
          api_key: 'snake_key',
          claim_token: 'snake_token',
          authkit_domain: 'snake.domain',
        }),
      });

      const result = await provisionOneShotEnvironment();

      expect(result).toEqual({
        clientId: 'camel_client',
        apiKey: 'camel_key',
        claimToken: 'camel_token',
        authkitDomain: 'camel.domain',
      });
    });

    it('throws OneShotApiError on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      await expect(provisionOneShotEnvironment()).rejects.toThrow('Rate limited. Please wait a moment and try again.');
      await expect(
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => '',
        }) && provisionOneShotEnvironment(),
      ).rejects.toThrow(OneShotApiError);
    });

    it('throws OneShotApiError on 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(provisionOneShotEnvironment()).rejects.toThrow('Server error: 500');
    });

    it('throws OneShotApiError with statusCode on HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => '',
      });

      try {
        await provisionOneShotEnvironment();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(OneShotApiError);
        expect((err as InstanceType<typeof OneShotApiError>).statusCode).toBe(503);
      }
    });

    it('throws OneShotApiError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failed'));

      await expect(provisionOneShotEnvironment()).rejects.toThrow('Network error: Network failed');
    });

    it('throws OneShotApiError on timeout (AbortError)', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(provisionOneShotEnvironment()).rejects.toThrow('Request timed out.');
    });

    it('throws when response is missing required fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clientId: 'client_123' }),
      });

      await expect(provisionOneShotEnvironment()).rejects.toThrow('missing required fields');
    });

    it('uses active environment endpoint when available', async () => {
      vi.mocked(getActiveEnvironment).mockReturnValue({
        name: 'local',
        type: 'sandbox',
        apiKey: 'sk_test_local',
        endpoint: 'http://localhost:8001',
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validResponse,
      });

      await provisionOneShotEnvironment();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8001/x/one-shot-environments',
        expect.anything(),
      );
    });
  });

  describe('createClaimNonce', () => {
    it('returns nonce on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nonce: 'nonce_abc123', alreadyClaimed: false }),
      });

      const result = await createClaimNonce('client_01ABC', 'ct_token');

      expect(result).toEqual({ nonce: 'nonce_abc123', alreadyClaimed: false });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.workos.com/x/one-shot-environments/claim-nonces',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: 'client_01ABC', claimToken: 'ct_token' }),
        }),
      );
    });

    it('returns alreadyClaimed when environment is claimed (camelCase)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ alreadyClaimed: true }),
      });

      const result = await createClaimNonce('client_01ABC', 'ct_token');

      expect(result).toEqual({ alreadyClaimed: true });
    });

    it('returns alreadyClaimed when environment is claimed (snake_case)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ already_claimed: true }),
      });

      const result = await createClaimNonce('client_01ABC', 'ct_token');

      expect(result).toEqual({ alreadyClaimed: true });
    });

    it('throws OneShotApiError on 401 (bad token)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(createClaimNonce('client_01ABC', 'bad_token')).rejects.toThrow('Invalid claim token.');
    });

    it('throws OneShotApiError on 404 (bad client_id)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      await expect(createClaimNonce('bad_client', 'ct_token')).rejects.toThrow('Environment not found.');
    });

    it('throws OneShotApiError on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '',
      });

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow(
        'Rate limited. Please wait a moment and try again.',
      );
    });

    it('throws OneShotApiError on server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow('Server error: 500');
    });

    it('throws OneShotApiError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow('Network error: DNS lookup failed');
    });

    it('throws OneShotApiError on timeout', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow('Request timed out.');
    });

    it('throws when response is missing nonce and not already claimed', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      });

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow('missing nonce');
    });
  });

  describe('generateCookiePassword', () => {
    it('returns a 32-character hex string', () => {
      const password = generateCookiePassword();
      expect(password).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique values', () => {
      const a = generateCookiePassword();
      const b = generateCookiePassword();
      expect(a).not.toBe(b);
    });
  });
});
