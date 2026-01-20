import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock telemetry client
const mockSetGatewayUrl = vi.fn();
const mockSetAccessToken = vi.fn();
const mockQueueEvent = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

vi.mock('./telemetry-client.js', () => ({
  telemetryClient: {
    setGatewayUrl: mockSetGatewayUrl,
    setAccessToken: mockSetAccessToken,
    queueEvent: mockQueueEvent,
    flush: mockFlush,
  },
}));

// Mock debug
vi.mock('./debug.js', () => ({
  debug: vi.fn(),
}));

// Mock uuid to return predictable values
vi.mock('uuid', () => ({
  v4: () => 'test-session-id-123',
}));

describe('Analytics', () => {
  // Need to handle WIZARD_TELEMETRY_ENABLED which is evaluated at import time
  const originalEnv = process.env.WIZARD_TELEMETRY;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure telemetry is enabled for tests
    delete process.env.WIZARD_TELEMETRY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WIZARD_TELEMETRY = originalEnv;
    } else {
      delete process.env.WIZARD_TELEMETRY;
    }
  });

  describe('with telemetry enabled', () => {
    let Analytics: typeof import('./analytics.js').Analytics;
    let analytics: InstanceType<typeof Analytics>;

    beforeEach(async () => {
      // Re-import to get fresh instance
      vi.resetModules();
      vi.doMock('./telemetry-client.js', () => ({
        telemetryClient: {
          setGatewayUrl: mockSetGatewayUrl,
          setAccessToken: mockSetAccessToken,
          queueEvent: mockQueueEvent,
          flush: mockFlush,
        },
      }));
      const module = await import('./analytics.js');
      Analytics = module.Analytics;
      analytics = new Analytics();
    });

    describe('setDistinctId', () => {
      it('stores the distinct ID for later use', () => {
        analytics.setDistinctId('user-123');
        analytics.sessionStart('cli', '1.0.0');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: expect.objectContaining({
              'workos.user_id': 'user-123',
            }),
          }),
        );
      });
    });

    describe('setAccessToken', () => {
      it('forwards to telemetry client', () => {
        analytics.setAccessToken('token-abc');
        expect(mockSetAccessToken).toHaveBeenCalledWith('token-abc');
      });
    });

    describe('setGatewayUrl', () => {
      it('forwards to telemetry client', () => {
        analytics.setGatewayUrl('http://localhost:8000');
        expect(mockSetGatewayUrl).toHaveBeenCalledWith('http://localhost:8000');
      });
    });

    describe('setTag', () => {
      it('accumulates tags for shutdown', async () => {
        analytics.setTag('framework', 'nextjs');
        analytics.setTag('hasAuth', true);
        analytics.setTag('fileCount', 42);

        await analytics.shutdown('success');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.end',
            attributes: expect.objectContaining({
              framework: 'nextjs',
              hasAuth: true,
              fileCount: 42,
            }),
          }),
        );
      });

      it('ignores null and undefined values in shutdown', async () => {
        analytics.setTag('valid', 'yes');
        analytics.setTag('nullValue', null);
        analytics.setTag('undefinedValue', undefined);

        await analytics.shutdown('success');

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(event.attributes.valid).toBe('yes');
        expect(event.attributes.nullValue).toBeUndefined();
        expect(event.attributes.undefinedValue).toBeUndefined();
      });
    });

    describe('capture', () => {
      it('accumulates properties as tags', async () => {
        analytics.capture('step_completed', { step: 'detect', success: true });

        await analytics.shutdown('success');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.end',
            attributes: expect.objectContaining({
              step: 'detect',
              success: true,
            }),
          }),
        );
      });

      it('ignores non-primitive values', async () => {
        analytics.capture('event', {
          primitive: 'yes',
          object: { nested: true },
          array: [1, 2, 3],
        });

        await analytics.shutdown('success');

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(event.attributes.primitive).toBe('yes');
        expect(event.attributes.object).toBeUndefined();
        expect(event.attributes.array).toBeUndefined();
      });
    });

    describe('captureException', () => {
      it('stores error type and message as tags', async () => {
        const error = new TypeError('Something went wrong');
        analytics.captureException(error);

        await analytics.shutdown('error');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.end',
            attributes: expect.objectContaining({
              'error.type': 'TypeError',
              'error.message': 'Something went wrong',
            }),
          }),
        );
      });
    });

    describe('sessionStart', () => {
      it('queues session.start event with version and mode', () => {
        analytics.sessionStart('tui', '2.0.0');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.start',
            sessionId: 'test-session-id-123',
            attributes: expect.objectContaining({
              'wizard.version': '2.0.0',
              'wizard.mode': 'tui',
            }),
          }),
        );
      });

      it('includes user ID if set', () => {
        analytics.setDistinctId('user-456');
        analytics.sessionStart('cli', '1.0.0');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: expect.objectContaining({
              'workos.user_id': 'user-456',
            }),
          }),
        );
      });
    });

    describe('shutdown', () => {
      it('queues session.end event with outcome', async () => {
        await analytics.shutdown('success');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.end',
            sessionId: 'test-session-id-123',
            attributes: expect.objectContaining({
              'wizard.outcome': 'success',
            }),
          }),
        );
      });

      it('includes duration_ms', async () => {
        // Small delay to ensure non-zero duration
        await new Promise((r) => setTimeout(r, 10));
        await analytics.shutdown('success');

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(event.attributes['wizard.duration_ms']).toBeGreaterThanOrEqual(0);
      });

      it('flushes events to telemetry client', async () => {
        await analytics.shutdown('success');
        expect(mockFlush).toHaveBeenCalled();
      });

      it('supports error outcome', async () => {
        await analytics.shutdown('error');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: expect.objectContaining({
              'wizard.outcome': 'error',
            }),
          }),
        );
      });

      it('supports cancelled outcome', async () => {
        await analytics.shutdown('cancelled');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: expect.objectContaining({
              'wizard.outcome': 'cancelled',
            }),
          }),
        );
      });
    });

    describe('getFeatureFlag', () => {
      it('returns undefined (not implemented)', async () => {
        const result = await analytics.getFeatureFlag('test-flag');
        expect(result).toBeUndefined();
      });
    });
  });

  describe('with telemetry disabled', () => {
    beforeEach(async () => {
      process.env.WIZARD_TELEMETRY = 'false';
      vi.resetModules();
      vi.doMock('./telemetry-client.js', () => ({
        telemetryClient: {
          setGatewayUrl: mockSetGatewayUrl,
          setAccessToken: mockSetAccessToken,
          queueEvent: mockQueueEvent,
          flush: mockFlush,
        },
      }));
    });

    it('capture does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.capture('event', { data: 'test' });

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('captureException does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.captureException(new Error('test'));

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('sessionStart does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.sessionStart('cli', '1.0.0');

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('shutdown does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      await analytics.shutdown('success');

      expect(mockQueueEvent).not.toHaveBeenCalled();
      expect(mockFlush).not.toHaveBeenCalled();
    });
  });
});
