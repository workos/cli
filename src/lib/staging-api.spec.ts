import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchStagingCredentials, StagingApiError } from './staging-api.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock the URL utility
vi.mock('../utils/urls.js', () => ({
  getWorkOSApiUrl: () => 'https://api.workos.com',
}));

// Mock debug utilities
vi.mock('../utils/debug.js', () => ({
  debug: vi.fn(),
  logToFile: vi.fn(),
}));

describe('staging-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchStagingCredentials', () => {
    it('returns clientId and apiKey on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            client_id: 'client_123',
            api_key: 'sk_test_abc',
          }),
      });

      const result = await fetchStagingCredentials('access_token_xyz');

      expect(result).toEqual({
        clientId: 'client_123',
        apiKey: 'sk_test_abc',
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/x/installer/staging-environment/credentials'),
        { headers: { Authorization: 'Bearer access_token_xyz' } }
      );
    });

    it('throws StagingApiError with 401 on auth failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      try {
        await fetchStagingCredentials('expired_token');
        expect.fail('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(StagingApiError);
        expect((e as StagingApiError).message).toBe('Authentication failed (401): Unauthorized');
        expect((e as StagingApiError).statusCode).toBe(401);
      }
    });

    it('throws StagingApiError with 403 on permission denied', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden'),
      });

      try {
        await fetchStagingCredentials('no_permission_token');
        expect.fail('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(StagingApiError);
        expect((e as StagingApiError).message).toBe('Access denied (403): Forbidden');
        expect((e as StagingApiError).statusCode).toBe(403);
      }
    });

    it('throws StagingApiError on other HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      try {
        await fetchStagingCredentials('valid_token');
        expect.fail('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(StagingApiError);
        expect((e as StagingApiError).message).toBe('Failed to fetch credentials: 500 Internal Server Error');
        expect((e as StagingApiError).statusCode).toBe(500);
      }
    });

    it('throws StagingApiError on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      try {
        await fetchStagingCredentials('valid_token');
        expect.fail('Expected to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(StagingApiError);
        expect((e as StagingApiError).message).toBe('Network error. Check your connection.');
        expect((e as StagingApiError).statusCode).toBeUndefined();
      }
    });
  });

  describe('StagingApiError', () => {
    it('has correct name and message', () => {
      const error = new StagingApiError('test message', 500);
      expect(error.name).toBe('StagingApiError');
      expect(error.message).toBe('test message');
      expect(error.statusCode).toBe(500);
    });

    it('works without statusCode', () => {
      const error = new StagingApiError('network error');
      expect(error.name).toBe('StagingApiError');
      expect(error.statusCode).toBeUndefined();
    });
  });
});
