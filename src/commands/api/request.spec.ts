import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../lib/api-key.js', () => ({
  resolveApiKey: vi.fn(() => 'sk_test_default'),
  resolveApiBaseUrl: vi.fn(() => 'https://api.example.com'),
}));

const { apiRequest } = await import('./request.js');
const { resolveApiKey, resolveApiBaseUrl } = await import('../../lib/api-key.js');

function buildResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses provided apiKey and baseUrl over resolver fallbacks', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{"ok":true}'));
    await apiRequest({
      method: 'GET',
      path: '/users',
      apiKey: 'sk_explicit',
      baseUrl: 'https://override.example.com',
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://override.example.com/users',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_explicit',
          Accept: 'application/json',
        }),
      }),
    );
    expect(resolveApiKey).not.toHaveBeenCalled();
    expect(resolveApiBaseUrl).not.toHaveBeenCalled();
  });

  it('falls back to resolveApiKey and resolveApiBaseUrl when not provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{}'));
    await apiRequest({ method: 'GET', path: '/users' });
    expect(resolveApiKey).toHaveBeenCalled();
    expect(resolveApiBaseUrl).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk_test_default' }),
      }),
    );
  });

  it('prefixes path with a leading slash when missing', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{}'));
    await apiRequest({ method: 'GET', path: 'users' });
    expect(fetchSpy).toHaveBeenCalledWith('https://api.example.com/users', expect.any(Object));
  });

  it('sends body and Content-Type when body is provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{}'));
    await apiRequest({ method: 'POST', path: '/orgs', body: '{"name":"Acme"}' });
    const init = fetchSpy.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Acme"}');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('omits Content-Type when no body is provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{}'));
    await apiRequest({ method: 'GET', path: '/orgs' });
    const init = fetchSpy.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('still sets Content-Type when an explicit empty-string body is provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{}'));
    await apiRequest({ method: 'POST', path: '/orgs', body: '' });
    const init = fetchSpy.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('');
  });

  it('parses a JSON response body', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{"id":"org_123"}', { status: 200 }));
    const response = await apiRequest({ method: 'GET', path: '/orgs/org_123' });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 'org_123' });
    expect(response.rawBody).toBe('{"id":"org_123"}');
  });

  it('returns the raw string when response body is not JSON', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('plain text', { status: 200 }));
    const response = await apiRequest({ method: 'GET', path: '/health' });
    expect(response.body).toBe('plain text');
    expect(response.rawBody).toBe('plain text');
  });

  it('preserves non-2xx status codes for the caller to inspect', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(buildResponse('{"error":"unauthorized"}', { status: 401 }));
    const response = await apiRequest({ method: 'GET', path: '/orgs' });
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
  });

  it('throws a friendly error when the network request fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(apiRequest({ method: 'GET', path: '/orgs' })).rejects.toThrow(/Failed to connect to WorkOS API/);
  });

  it('preserves the original network error detail and cause for debugging', async () => {
    const original = new Error('getaddrinfo ENOTFOUND api.workos.com');
    vi.spyOn(global, 'fetch').mockRejectedValue(original);
    let caught: unknown;
    try {
      await apiRequest({ method: 'GET', path: '/orgs' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('getaddrinfo ENOTFOUND api.workos.com');
    expect((caught as Error).cause).toBe(original);
  });
});
