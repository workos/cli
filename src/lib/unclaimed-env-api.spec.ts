import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/debug.js', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('./api-key.js', () => ({
  resolveApiBaseUrl: vi.fn(() => 'https://api.workos.com'),
}));

const { provisionUnclaimedEnvironment, createClaimNonce, UnclaimedEnvApiError } =
  await import('./unclaimed-env-api.js');
const { resolveApiBaseUrl } = await import('./api-key.js');

describe('unclaimed-env-api', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
    vi.mocked(resolveApiBaseUrl).mockReturnValue('https://api.workos.com');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('provisionUnclaimedEnvironment', () => {
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

      const result = await provisionUnclaimedEnvironment();

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

      const result = await provisionUnclaimedEnvironment();

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

      const result = await provisionUnclaimedEnvironment();

      expect(result).toEqual({
        clientId: 'camel_client',
        apiKey: 'camel_key',
        claimToken: 'camel_token',
        authkitDomain: 'camel.domain',
      });
    });

    it('throws UnclaimedEnvApiError on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests',
      });

      await expect(provisionUnclaimedEnvironment()).rejects.toThrow(
        'Rate limited. Please wait a moment and try again.',
      );
      await expect(
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: async () => '',
        }) && provisionUnclaimedEnvironment(),
      ).rejects.toThrow(UnclaimedEnvApiError);
    });

    it('throws UnclaimedEnvApiError on 500 server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(provisionUnclaimedEnvironment()).rejects.toThrow('Server error: 500');
    });

    it('throws UnclaimedEnvApiError with statusCode on HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => '',
      });

      try {
        await provisionUnclaimedEnvironment();
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(UnclaimedEnvApiError);
        expect((err as InstanceType<typeof UnclaimedEnvApiError>).statusCode).toBe(503);
      }
    });

    it('throws UnclaimedEnvApiError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failed'));

      await expect(provisionUnclaimedEnvironment()).rejects.toThrow('Network error: Network failed');
    });

    it('throws UnclaimedEnvApiError on timeout (AbortError)', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(provisionUnclaimedEnvironment()).rejects.toThrow('Request timed out.');
    });

    it('throws when response is missing required fields', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clientId: 'client_123' }),
      });

      await expect(provisionUnclaimedEnvironment()).rejects.toThrow('missing required fields');
    });

    it('uses active environment endpoint when available', async () => {
      vi.mocked(resolveApiBaseUrl).mockReturnValue('http://localhost:8001');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => validResponse,
      });

      await provisionUnclaimedEnvironment();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8001/x/one-shot-environments', expect.anything());
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
          body: JSON.stringify({ client_id: 'client_01ABC', claim_token: 'ct_token' }),
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

    it('throws UnclaimedEnvApiError on 401 (bad token)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(createClaimNonce('client_01ABC', 'bad_token')).rejects.toThrow('Invalid claim token.');
    });

    it('throws UnclaimedEnvApiError on 404 (bad client_id)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      await expect(createClaimNonce('bad_client', 'ct_token')).rejects.toThrow('Environment not found.');
    });

    it('returns alreadyClaimed on 409 Conflict (claimed server-side)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'Conflict',
      });

      const result = await createClaimNonce('client_01ABC', 'ct_token');

      expect(result).toEqual({ alreadyClaimed: true });
    });

    it('throws UnclaimedEnvApiError on 429 rate limit', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => '',
      });

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow(
        'Rate limited. Please wait a moment and try again.',
      );
    });

    it('throws UnclaimedEnvApiError on server error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow('Server error: 500');
    });

    it('throws UnclaimedEnvApiError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('DNS lookup failed'));

      await expect(createClaimNonce('client_01ABC', 'ct_token')).rejects.toThrow('Network error: DNS lookup failed');
    });

    it('throws UnclaimedEnvApiError on timeout', async () => {
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
});
