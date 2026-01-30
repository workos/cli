import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TelemetryEvent } from './telemetry-types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock debug to avoid console output
vi.mock('./debug.js', () => ({
  debug: vi.fn(),
}));

// Mock credentials module
const mockGetCredentials = vi.fn();
vi.mock('../lib/credentials.js', () => ({
  getCredentials: () => mockGetCredentials(),
}));

// Import after mocks are set up
const { TelemetryClient } = await import('./telemetry-client.js');

describe('TelemetryClient', () => {
  let client: InstanceType<typeof TelemetryClient>;

  beforeEach(() => {
    client = new TelemetryClient();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true });
    mockGetCredentials.mockReset();
    mockGetCredentials.mockReturnValue(null); // Default: no credentials
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('setGatewayUrl', () => {
    it('sets the gateway URL', async () => {
      client.setGatewayUrl('http://localhost:8000');
      client.setAccessToken('test-token');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();

      expect(mockFetch).toHaveBeenCalledWith('http://localhost:8000/telemetry', expect.any(Object));
    });
  });

  describe('setAccessToken', () => {
    it('uses cached token as fallback when no fresh credentials', async () => {
      client.setGatewayUrl('http://localhost:8000');
      client.setAccessToken('my-secret-token');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-secret-token',
          }),
        }),
      );
    });

    it('prefers fresh credentials over cached token', async () => {
      mockGetCredentials.mockReturnValue({ accessToken: 'fresh-token' });
      client.setGatewayUrl('http://localhost:8000');
      client.setAccessToken('stale-cached-token');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer fresh-token',
          }),
        }),
      );
    });

    it('omits Authorization header when no token', async () => {
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();

      const callArgs = mockFetch.mock.calls[0][1];
      expect(callArgs.headers.Authorization).toBeUndefined();
    });
  });

  describe('queueEvent', () => {
    it('accumulates events for later flush', async () => {
      client.setGatewayUrl('http://localhost:8000');

      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: '2024-01-01T00:00:00Z' });
      client.queueEvent({ type: 'session.end', sessionId: '123', timestamp: '2024-01-01T00:01:00Z' });

      await client.flush();

      const callArgs = mockFetch.mock.calls[0][1];
      const body = JSON.parse(callArgs.body);
      expect(body.events).toHaveLength(2);
      expect(body.events[0].type).toBe('session.start');
      expect(body.events[1].type).toBe('session.end');
    });
  });

  describe('flush', () => {
    it('skips if no events queued', async () => {
      client.setGatewayUrl('http://localhost:8000');

      await client.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips if no gateway URL configured', async () => {
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('clears events after successful flush', async () => {
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();
      await client.flush(); // Second flush should be no-op

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('clears events even if flush fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush(); // Should not throw
      await client.flush(); // Should be no-op

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('handles network errors silently', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      // Should not throw
      await expect(client.flush()).resolves.toBeUndefined();
    });

    it('handles non-ok responses silently', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      // Should not throw
      await expect(client.flush()).resolves.toBeUndefined();
    });

    it('sends correct Content-Type header', async () => {
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });
  });
});
