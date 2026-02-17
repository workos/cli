import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { workosRequest, WorkOSApiError } = await import('./workos-api.js');

describe('workos-api', () => {
  const mockFetch = vi.fn();
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockResponse(status: number, body: unknown, ok = status >= 200 && status < 300): Response {
    const text = body !== null ? JSON.stringify(body) : '';
    return {
      ok,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(text),
    } as Response;
  }

  function mockTextResponse(status: number, text: string, ok = status >= 200 && status < 300): Response {
    return { ok, status, text: () => Promise.resolve(text) } as Response;
  }

  describe('workosRequest', () => {
    it('sets Authorization header with Bearer token', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'org_123' }));
      await workosRequest({ method: 'GET', path: '/organizations/org_123', apiKey: 'sk_test_abc' });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer sk_test_abc' }),
        }),
      );
    });

    it('builds URL with default base URL', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'org_123' }));
      await workosRequest({ method: 'GET', path: '/organizations/org_123', apiKey: 'sk_test' });
      expect(mockFetch).toHaveBeenCalledWith('https://api.workos.com/organizations/org_123', expect.any(Object));
    });

    it('builds URL with custom base URL', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'org_123' }));
      await workosRequest({
        method: 'GET',
        path: '/organizations/org_123',
        apiKey: 'sk_test',
        baseUrl: 'http://localhost:8001',
      });
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8001/organizations/org_123', expect.any(Object));
    });

    it('appends query params for GET requests', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { data: [] }));
      await workosRequest({
        method: 'GET',
        path: '/organizations',
        apiKey: 'sk_test',
        params: { limit: 10, order: 'desc', empty: undefined },
      });
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('limit=10');
      expect(calledUrl).toContain('order=desc');
      expect(calledUrl).not.toContain('empty');
    });

    it('sends JSON body for POST requests', async () => {
      mockFetch.mockResolvedValue(mockResponse(201, { id: 'org_123', name: 'Test' }));
      await workosRequest({
        method: 'POST',
        path: '/organizations',
        apiKey: 'sk_test',
        body: { name: 'Test' },
      });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ name: 'Test' }),
        }),
      );
    });

    it('does not send body for DELETE requests', async () => {
      mockFetch.mockResolvedValue(mockResponse(204, null));
      await workosRequest({ method: 'DELETE', path: '/organizations/org_123', apiKey: 'sk_test' });
      const opts = mockFetch.mock.calls[0][1];
      expect(opts.body).toBeUndefined();
    });

    it('returns parsed JSON response', async () => {
      mockFetch.mockResolvedValue(mockResponse(200, { id: 'org_123', name: 'Test' }));
      const result = await workosRequest<{ id: string; name: string }>({
        method: 'GET',
        path: '/organizations/org_123',
        apiKey: 'sk_test',
      });
      expect(result).toEqual({ id: 'org_123', name: 'Test' });
    });

    it('returns null for 204 No Content', async () => {
      mockFetch.mockResolvedValue(mockTextResponse(204, ''));
      const result = await workosRequest({ method: 'DELETE', path: '/organizations/org_123', apiKey: 'sk_test' });
      expect(result).toBeNull();
    });

    it('returns null for 202 Accepted', async () => {
      mockFetch.mockResolvedValue(mockTextResponse(202, 'Accepted'));
      const result = await workosRequest({ method: 'DELETE', path: '/organizations/org_123', apiKey: 'sk_test' });
      expect(result).toBeNull();
    });

    it('throws WorkOSApiError on 401', async () => {
      mockFetch.mockResolvedValue(mockResponse(401, { message: 'Unauthorized' }, false));
      await expect(workosRequest({ method: 'GET', path: '/organizations', apiKey: 'bad_key' })).rejects.toThrow(
        WorkOSApiError,
      );
      try {
        await workosRequest({ method: 'GET', path: '/organizations', apiKey: 'bad_key' });
      } catch (e) {
        expect((e as WorkOSApiError).statusCode).toBe(401);
      }
    });

    it('throws WorkOSApiError on 404', async () => {
      mockFetch.mockResolvedValue(mockResponse(404, { message: 'Not Found' }, false));
      await expect(workosRequest({ method: 'GET', path: '/organizations/missing', apiKey: 'sk_test' })).rejects.toThrow(
        WorkOSApiError,
      );
    });

    it('throws WorkOSApiError with validation errors on 422', async () => {
      mockFetch.mockResolvedValue(
        mockResponse(
          422,
          { message: 'Validation failed', code: 'validation_error', errors: [{ message: 'Name required' }] },
          false,
        ),
      );
      try {
        await workosRequest({ method: 'POST', path: '/organizations', apiKey: 'sk_test', body: {} });
      } catch (e) {
        const err = e as WorkOSApiError;
        expect(err.statusCode).toBe(422);
        expect(err.code).toBe('validation_error');
        expect(err.errors).toHaveLength(1);
      }
    });

    it('throws on network error', async () => {
      mockFetch.mockRejectedValue(new TypeError('fetch failed'));
      await expect(workosRequest({ method: 'GET', path: '/organizations', apiKey: 'sk_test' })).rejects.toThrow(
        'Failed to connect to WorkOS API',
      );
    });
  });
});
