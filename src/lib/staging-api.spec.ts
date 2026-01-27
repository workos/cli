import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchStagingCredentials, StagingApiError } from './staging-api.js';

describe('staging-api', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('fetchStagingCredentials', () => {
    it('returns credentials from camelCase response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clientId: 'client_123', apiKey: 'sk_test_abc' }),
      });

      const result = await fetchStagingCredentials('token_xyz');

      expect(result).toEqual({ clientId: 'client_123', apiKey: 'sk_test_abc' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.workos.com/x/installer/staging-environment/credentials',
        expect.objectContaining({
          headers: { Authorization: 'Bearer token_xyz' },
        }),
      );
    });

    it('returns credentials from snake_case response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ client_id: 'client_456', api_key: 'sk_test_def' }),
      });

      const result = await fetchStagingCredentials('token_xyz');

      expect(result).toEqual({ clientId: 'client_456', apiKey: 'sk_test_def' });
    });

    it('prefers camelCase over snake_case when both present', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          clientId: 'camel_client',
          apiKey: 'camel_key',
          client_id: 'snake_client',
          api_key: 'snake_key',
        }),
      });

      const result = await fetchStagingCredentials('token');

      expect(result).toEqual({ clientId: 'camel_client', apiKey: 'camel_key' });
    });

    it('throws StagingApiError on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(fetchStagingCredentials('bad_token')).rejects.toThrow('Authentication expired');
    });

    it('throws StagingApiError instance on 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized',
      });

      await expect(fetchStagingCredentials('bad_token')).rejects.toThrow(StagingApiError);
    });

    it('throws StagingApiError on 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden',
      });

      await expect(fetchStagingCredentials('token')).rejects.toThrow('Access denied');
    });

    it('throws StagingApiError on 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => 'Not Found',
      });

      await expect(fetchStagingCredentials('token')).rejects.toThrow('No staging environment found');
    });

    it('throws StagingApiError on other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(fetchStagingCredentials('token')).rejects.toThrow('Failed to fetch credentials: 500');
    });

    it('throws StagingApiError when response missing clientId', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ apiKey: 'sk_test_abc' }),
      });

      await expect(fetchStagingCredentials('token')).rejects.toThrow('missing clientId or apiKey');
    });

    it('throws StagingApiError when response missing apiKey', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ clientId: 'client_123' }),
      });

      await expect(fetchStagingCredentials('token')).rejects.toThrow('missing clientId or apiKey');
    });

    it('throws StagingApiError on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failed'));

      await expect(fetchStagingCredentials('token')).rejects.toThrow('Network error: Network failed');
    });

    it('throws StagingApiError on timeout (AbortError)', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      await expect(fetchStagingCredentials('token')).rejects.toThrow('Request timed out');
    });
  });
});
