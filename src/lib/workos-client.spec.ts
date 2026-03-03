import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock workos-api before any imports that use it
vi.mock('./workos-api.js', () => ({
  workosRequest: vi.fn(),
  WorkOSApiError: class WorkOSApiError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code?: string,
      public readonly errors?: Array<{ message: string }>,
    ) {
      super(message);
      this.name = 'WorkOSApiError';
    }
  },
}));

// Mock api-key to avoid config-store dependency
vi.mock('./api-key.js', () => ({
  resolveApiKey: () => 'sk_test_default',
  resolveApiBaseUrl: () => 'https://api.workos.com',
}));

const { workosRequest, WorkOSApiError } = await import('./workos-api.js');
const mockRequest = vi.mocked(workosRequest);

const { createWorkOSClient } = await import('./workos-client.js');

describe('workos-client', () => {
  beforeEach(() => {
    mockRequest.mockReset();
  });

  describe('createWorkOSClient', () => {
    it('creates client with explicit apiKey and baseUrl', () => {
      const client = createWorkOSClient('sk_test_123', 'https://custom.api.com');
      expect(client.sdk).toBeDefined();
      expect(client.sdk.key).toBe('sk_test_123');
      expect(client.sdk.baseURL).toBe('https://custom.api.com');
    });

    it('falls back to resolveApiKey/resolveApiBaseUrl when no args', () => {
      const client = createWorkOSClient();
      expect(client.sdk.key).toBe('sk_test_default');
      expect(client.sdk.baseURL).toBe('https://api.workos.com');
    });

    it('exposes sdk, webhooks, redirectUris, corsOrigins, homepageUrl', () => {
      const client = createWorkOSClient('sk_test_123');
      expect(client.sdk).toBeDefined();
      expect(client.webhooks).toBeDefined();
      expect(client.redirectUris).toBeDefined();
      expect(client.corsOrigins).toBeDefined();
      expect(client.homepageUrl).toBeDefined();
    });
  });

  describe('webhooks', () => {
    it('list calls correct path', async () => {
      const mockData = { data: [], list_metadata: { before: null, after: null } };
      mockRequest.mockResolvedValue(mockData);

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.webhooks.list();

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          path: '/webhook_endpoints',
          apiKey: 'sk_test_123',
          baseUrl: 'https://api.workos.com',
        }),
      );
      expect(result).toBe(mockData);
    });

    it('create calls correct path with body', async () => {
      const mockEndpoint = { id: 'we_123', url: 'https://example.com/hook', events: ['user.created'] };
      mockRequest.mockResolvedValue(mockEndpoint);

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.webhooks.create('https://example.com/hook', ['user.created']);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/webhook_endpoints',
          body: { endpoint_url: 'https://example.com/hook', events: ['user.created'] },
        }),
      );
      expect(result).toBe(mockEndpoint);
    });

    it('delete calls correct path', async () => {
      mockRequest.mockResolvedValue(null);

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      await client.webhooks.delete('we_123');

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'DELETE',
          path: '/webhook_endpoints/we_123',
        }),
      );
    });
  });

  describe('redirectUris', () => {
    it('add returns success on 201', async () => {
      mockRequest.mockResolvedValue({ id: 'ru_123' });

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.redirectUris.add('http://localhost:3000/callback');

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/user_management/redirect_uris',
          body: { uri: 'http://localhost:3000/callback' },
        }),
      );
      expect(result).toEqual({ success: true, alreadyExists: false });
    });

    it('add treats 422 "already exists" as success', async () => {
      mockRequest.mockRejectedValue(new WorkOSApiError('URI already exists', 422));

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.redirectUris.add('http://localhost:3000/callback');

      expect(result).toEqual({ success: true, alreadyExists: true });
    });

    it('add treats 409 as success', async () => {
      mockRequest.mockRejectedValue(new WorkOSApiError('Conflict', 409));

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.redirectUris.add('http://localhost:3000/callback');

      expect(result).toEqual({ success: true, alreadyExists: true });
    });

    it('add rethrows other errors', async () => {
      mockRequest.mockRejectedValue(new WorkOSApiError('Unauthorized', 401));

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      await expect(client.redirectUris.add('http://localhost:3000/callback')).rejects.toThrow('Unauthorized');
    });
  });

  describe('corsOrigins', () => {
    it('add returns success on 201', async () => {
      mockRequest.mockResolvedValue({ id: 'co_123' });

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.corsOrigins.add('http://localhost:3000');

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/user_management/cors_origins',
          body: { origin: 'http://localhost:3000' },
        }),
      );
      expect(result).toEqual({ success: true, alreadyExists: false });
    });

    it('add treats 422 "already exists" as success', async () => {
      mockRequest.mockRejectedValue(new WorkOSApiError('Origin already exists', 422));

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      const result = await client.corsOrigins.add('http://localhost:3000');

      expect(result).toEqual({ success: true, alreadyExists: true });
    });

    it('add rethrows other errors', async () => {
      mockRequest.mockRejectedValue(new WorkOSApiError('Server Error', 500));

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      await expect(client.corsOrigins.add('http://localhost:3000')).rejects.toThrow('Server Error');
    });
  });

  describe('homepageUrl', () => {
    it('set calls correct path with body', async () => {
      mockRequest.mockResolvedValue(null);

      const client = createWorkOSClient('sk_test_123', 'https://api.workos.com');
      await client.homepageUrl.set('http://localhost:3000');

      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          path: '/user_management/app_homepage_url',
          body: { url: 'http://localhost:3000' },
        }),
      );
    });
  });
});
