import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  requestDeviceCode,
  pollForToken,
  runDeviceAuthFlow,
  startDeviceAuth,
  DeviceAuthError,
  type DeviceAuthOptions,
  type DeviceAuthResponse,
} from './device-auth.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock opn
vi.mock('opn', () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

describe('device-auth', () => {
  const baseOptions: DeviceAuthOptions = {
    clientId: 'test_client_id',
    authkitDomain: 'https://auth.example.com',
  };

  const mockDeviceAuthResponse: DeviceAuthResponse = {
    device_code: 'device_code_123',
    user_code: 'USER-CODE',
    verification_uri: 'https://auth.example.com/verify',
    verification_uri_complete: 'https://auth.example.com/verify?code=USER-CODE',
    expires_in: 600,
    interval: 5,
  };

  // Valid JWT tokens for testing (base64url encoded)
  const mockIdToken = [
    'eyJhbGciOiJSUzI1NiJ9', // header
    Buffer.from(JSON.stringify({ sub: 'user_123', email: 'test@example.com' })).toString('base64url'),
    'signature',
  ].join('.');

  const mockAccessToken = [
    'eyJhbGciOiJSUzI1NiJ9', // header
    Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url'),
    'signature',
  ].join('.');

  const mockTokenResponse = {
    access_token: mockAccessToken,
    id_token: mockIdToken,
    token_type: 'Bearer',
    expires_in: 3600,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('requestDeviceCode', () => {
    it('returns device code response on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeviceAuthResponse),
      });

      const result = await requestDeviceCode(baseOptions);

      expect(result).toEqual(mockDeviceAuthResponse);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://auth.example.com/oauth2/device_authorization',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        })
      );
    });

    it('includes staging scope by default', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeviceAuthResponse),
      });

      await requestDeviceCode(baseOptions);

      const call = mockFetch.mock.calls[0];
      const body = call[1].body as URLSearchParams;
      const scope = body.get('scope');

      expect(scope).toContain('openid');
      expect(scope).toContain('profile');
      expect(scope).toContain('email');
      expect(scope).toContain('staging-environment:credentials:read');
    });

    it('uses custom scopes when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeviceAuthResponse),
      });

      await requestDeviceCode({ ...baseOptions, scopes: ['openid', 'custom'] });

      const call = mockFetch.mock.calls[0];
      const body = call[1].body as URLSearchParams;
      expect(body.get('scope')).toBe('openid custom');
    });

    it('throws DeviceAuthError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve('Bad Request'),
      });

      await expect(requestDeviceCode(baseOptions)).rejects.toThrow(
        /Device authorization failed: 400/
      );
    });
  });

  describe('pollForToken', () => {
    it('returns token after successful auth', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const pollPromise = pollForToken('device_code_123', { ...baseOptions, interval: 5 });

      // Advance timer past poll interval
      await vi.advanceTimersByTimeAsync(5000);

      const result = await pollPromise;

      expect(result.accessToken).toBe(mockAccessToken);
      expect(result.idToken).toBe(mockIdToken);
      expect(result.userId).toBe('user_123');
      expect(result.email).toBe('test@example.com');
    });

    it('continues polling on authorization_pending', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'authorization_pending' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        });

      const pollPromise = pollForToken('device_code_123', { ...baseOptions, interval: 5 });

      // First poll - authorization_pending
      await vi.advanceTimersByTimeAsync(5000);
      // Second poll - success
      await vi.advanceTimersByTimeAsync(5000);

      const result = await pollPromise;
      expect(result.userId).toBe('user_123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('increases interval on slow_down', async () => {
      const onSlowDown = vi.fn();

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'slow_down' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        });

      const pollPromise = pollForToken('device_code_123', {
        ...baseOptions,
        interval: 5,
        onSlowDown,
      });

      // First poll at 5s - slow_down
      await vi.advanceTimersByTimeAsync(5000);

      // Interval should now be 10s (5s + 5s)
      expect(onSlowDown).toHaveBeenCalledWith(10000);

      // Second poll after increased interval
      await vi.advanceTimersByTimeAsync(10000);

      const result = await pollPromise;
      expect(result.userId).toBe('user_123');
    });

    it('throws after timeout', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      });

      let caughtError: Error | null = null;

      const pollPromise = pollForToken('device_code_123', {
        ...baseOptions,
        interval: 1, // 1 second interval
        timeoutMs: 2500, // 2.5 second timeout
      }).catch((e) => {
        caughtError = e;
      });

      // Use runAllTimersAsync to complete all pending timers
      await vi.runAllTimersAsync();
      await pollPromise;

      expect(caughtError).toBeInstanceOf(DeviceAuthError);
      expect((caughtError as DeviceAuthError).message).toBe('Authentication timed out after 5 minutes');
    });

    it('calls onPoll callback each iteration', async () => {
      const onPoll = vi.fn();

      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: 'authorization_pending' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        });

      const pollPromise = pollForToken('device_code_123', {
        ...baseOptions,
        interval: 5,
        onPoll,
      });

      await vi.advanceTimersByTimeAsync(5000);
      await vi.advanceTimersByTimeAsync(5000);

      await pollPromise;
      expect(onPoll).toHaveBeenCalledTimes(2);
    });

    it('throws on unexpected error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'access_denied' }),
      });

      let caughtError: Error | null = null;

      const pollPromise = pollForToken('device_code_123', { ...baseOptions, interval: 1 }).catch((e) => {
        caughtError = e;
      });

      await vi.runAllTimersAsync();
      await pollPromise;

      expect(caughtError).toBeInstanceOf(DeviceAuthError);
      expect((caughtError as DeviceAuthError).message).toBe('Token error: access_denied');
    });
  });

  describe('runDeviceAuthFlow', () => {
    it('orchestrates request + poll', async () => {
      // First call: device authorization
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeviceAuthResponse),
      });
      // Second call: token
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockTokenResponse),
      });

      const flowPromise = runDeviceAuthFlow(baseOptions);

      // Wait for device auth request
      await vi.advanceTimersByTimeAsync(0);

      // Advance past poll interval
      await vi.advanceTimersByTimeAsync(5000);

      const result = await flowPromise;
      expect(result.userId).toBe('user_123');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('startDeviceAuth', () => {
    it('returns device auth and poll function separately', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockDeviceAuthResponse),
      });

      const { deviceAuth, poll } = await startDeviceAuth(baseOptions);

      expect(deviceAuth).toEqual(mockDeviceAuthResponse);
      expect(typeof poll).toBe('function');
    });

    it('poll function executes polling', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockDeviceAuthResponse),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockTokenResponse),
        });

      const { poll } = await startDeviceAuth(baseOptions);
      const pollPromise = poll();

      await vi.advanceTimersByTimeAsync(5000);

      const result = await pollPromise;
      expect(result.userId).toBe('user_123');
    });
  });

  describe('DeviceAuthError', () => {
    it('has correct name', () => {
      const error = new DeviceAuthError('test error');
      expect(error.name).toBe('DeviceAuthError');
      expect(error.message).toBe('test error');
    });
  });
});
