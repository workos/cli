import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

// Mock fs for persistToFile tests
const mockMkdirSync = vi.fn();
const mockWriteFileSync = vi.fn();
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
    writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  };
});

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

    it('retains events when flush fails (for store-forward)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush(); // Should not throw, events retained
      await client.flush(); // Should retry since events are still queued

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('retains events on non-ok response (for store-forward)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await client.flush(); // Events retained on 500
      await client.flush(); // Should retry

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('returns false on network errors (retryable)', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await expect(client.flush()).resolves.toBe(false);
    });

    it('returns false on 5xx (retryable, events retained)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      await expect(client.flush()).resolves.toBe(false);
    });

    it('drops events on 4xx and returns true (permanent failure)', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvent({ type: 'session.start', sessionId: '123', timestamp: new Date().toISOString() });

      const result = await client.flush();
      expect(result).toBe(true);
      // Verify events were cleared — second flush should be a no-op
      mockFetch.mockClear();
      await client.flush();
      expect(mockFetch).not.toHaveBeenCalled();
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

  describe('queueEvents', () => {
    it('queues multiple events at once', async () => {
      client.setGatewayUrl('http://localhost:8000');
      client.queueEvents([
        { type: 'command', sessionId: '1', timestamp: '2024-01-01T00:00:00Z' },
        { type: 'crash', sessionId: '1', timestamp: '2024-01-01T00:00:01Z' },
      ]);

      await client.flush();
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.events).toHaveLength(2);
    });
  });

  describe('persistToFile', () => {
    beforeEach(() => {
      mockMkdirSync.mockReset();
      mockWriteFileSync.mockReset();
    });

    it('writes events to file and clears queue', async () => {
      client.queueEvent({ type: 'session.start', sessionId: '1', timestamp: '2024-01-01T00:00:00Z' });
      client.persistToFile('/tmp/test-persist.json');

      expect(mockMkdirSync).toHaveBeenCalledWith('/tmp', { recursive: true });
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        '/tmp/test-persist.json',
        expect.stringContaining('session.start'),
        'utf-8',
      );

      // Queue should be empty after persist
      client.setGatewayUrl('http://localhost:8000');
      await client.flush();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does nothing when no events queued', () => {
      client.persistToFile('/tmp/test-persist.json');
      expect(mockWriteFileSync).not.toHaveBeenCalled();
    });

    it('fails silently on write error', () => {
      mockMkdirSync.mockImplementation(() => {
        throw new Error('EACCES');
      });

      client.queueEvent({ type: 'session.start', sessionId: '1', timestamp: '2024-01-01T00:00:00Z' });
      expect(() => client.persistToFile('/tmp/test-persist.json')).not.toThrow();
    });
  });
});
