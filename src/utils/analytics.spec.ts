import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock telemetry client
const mockSetGatewayUrl = vi.fn();
const mockSetAccessToken = vi.fn();
const mockSetClaimTokenAuth = vi.fn();
const mockSetApiKeyAuth = vi.fn();
const mockQueueEvent = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

vi.mock('./telemetry-client.js', () => ({
  telemetryClient: {
    setGatewayUrl: mockSetGatewayUrl,
    setAccessToken: mockSetAccessToken,
    setClaimTokenAuth: mockSetClaimTokenAuth,
    setApiKeyAuth: mockSetApiKeyAuth,
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

// Deterministic device ID for assertions
const TEST_DEVICE_ID = '11111111-1111-4111-8111-111111111111';
vi.mock('../lib/device-id.js', () => ({
  getDeviceId: () => TEST_DEVICE_ID,
}));

// Mock settings for initForNonInstaller
const mockGetTelemetryUrl = vi.fn(() => 'https://api.workos.com/cli');
const mockSettingsConfig = {
  nodeVersion: '>=18',
  logging: { debugMode: false },
  telemetry: { enabled: true, eventName: 'installer_interaction' },
  documentation: {
    workosDocsUrl: 'https://workos.com/docs',
    dashboardUrl: 'https://dashboard.workos.com',
    issuesUrl: 'https://github.com',
  },
  legacy: { oauthPort: 3000 },
};
vi.mock('../lib/settings.js', () => ({
  getTelemetryUrl: () => mockGetTelemetryUrl(),
  getConfig: () => mockSettingsConfig,
  getVersion: () => '0.12.1',
}));

// Mock credentials for initForNonInstaller
const mockGetCredentials = vi.fn();
vi.mock('../lib/credentials.js', () => ({
  getCredentials: () => mockGetCredentials(),
  isTokenExpired: (creds: { expiresAt: number }) => Date.now() >= creds.expiresAt,
}));

// Mock config-store so auth.mode derivation can exercise unclaimed-env path
const mockGetActiveEnvironment = vi.fn();
vi.mock('../lib/config-store.js', () => ({
  getActiveEnvironment: () => mockGetActiveEnvironment(),
  isUnclaimedEnvironment: (env: { type: string }) => env?.type === 'unclaimed',
}));

describe('Analytics', () => {
  // Need to handle WORKOS_TELEMETRY_ENABLED which is evaluated at import time
  const originalEnv = process.env.WORKOS_TELEMETRY;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure telemetry is enabled for tests
    delete process.env.WORKOS_TELEMETRY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WORKOS_TELEMETRY = originalEnv;
    } else {
      delete process.env.WORKOS_TELEMETRY;
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
          setClaimTokenAuth: mockSetClaimTokenAuth,
          setApiKeyAuth: mockSetApiKeyAuth,
          queueEvent: mockQueueEvent,
          flush: mockFlush,
        },
      }));
      vi.doMock('../lib/settings.js', () => ({
        getTelemetryUrl: () => mockGetTelemetryUrl(),
        getConfig: () => mockSettingsConfig,
        getVersion: () => '0.12.1',
      }));
      vi.doMock('../lib/credentials.js', () => ({
        getCredentials: () => mockGetCredentials(),
        isTokenExpired: (creds: { expiresAt: number }) => Date.now() >= creds.expiresAt,
      }));
      vi.doMock('../lib/device-id.js', () => ({
        getDeviceId: () => TEST_DEVICE_ID,
      }));
      vi.doMock('../lib/config-store.js', () => ({
        getActiveEnvironment: () => mockGetActiveEnvironment(),
        isUnclaimedEnvironment: (env: { type: string }) => env?.type === 'unclaimed',
      }));
      // Default: no credentials, no unclaimed env, no API key
      mockGetCredentials.mockReturnValue(null);
      mockGetActiveEnvironment.mockReturnValue(null);
      delete process.env.WORKOS_API_KEY;
      const module = await import('./analytics.js');
      Analytics = module.Analytics;
      analytics = new Analytics();
    });

    afterEach(() => {
      delete process.env.WORKOS_API_KEY;
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

      it('carries the detected integration into session.end', async () => {
        // run-with-core sets this from the final machine snapshot; the API
        // tags install metrics by `installer.integration`.
        analytics.setTag('installer.integration', 'nextjs');

        await analytics.shutdown('success');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'session.end',
            attributes: expect.objectContaining({
              'installer.integration': 'nextjs',
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
              'installer.version': '2.0.0',
              'installer.mode': 'tui',
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

      it('includes environment fingerprint fields', () => {
        analytics.sessionStart('cli', '1.0.0');

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.start')[0];
        expect(event.attributes).toHaveProperty('env.os');
        expect(event.attributes).toHaveProperty('env.os_version');
        expect(event.attributes).toHaveProperty('env.node_version');
        expect(event.attributes).toHaveProperty('env.shell');
        expect(typeof event.attributes['env.ci']).toBe('boolean');
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
              'installer.outcome': 'success',
            }),
          }),
        );
      });

      it('includes duration_ms', async () => {
        // Small delay to ensure non-zero duration
        await new Promise((r) => setTimeout(r, 10));
        await analytics.shutdown('success');

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(event.attributes['installer.duration_ms']).toBeGreaterThanOrEqual(0);
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
              'installer.outcome': 'error',
            }),
          }),
        );
      });

      it('supports cancelled outcome', async () => {
        await analytics.shutdown('cancelled');

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            attributes: expect.objectContaining({
              'installer.outcome': 'cancelled',
            }),
          }),
        );
      });

      it('includes env fingerprint and installer.mode', async () => {
        analytics.sessionStart('tui', '1.0.0');
        mockQueueEvent.mockClear();

        await analytics.shutdown('success');

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(event.attributes).toHaveProperty('env.os');
        expect(event.attributes).toHaveProperty('env.os_version');
        expect(event.attributes).toHaveProperty('env.node_version');
        expect(event.attributes).toHaveProperty('env.shell');
        expect(typeof event.attributes['env.ci']).toBe('boolean');
        expect(event.attributes['installer.mode']).toBe('tui');
      });
    });

    describe('getFeatureFlag', () => {
      it('returns undefined (not implemented)', async () => {
        const result = await analytics.getFeatureFlag('test-flag');
        expect(result).toBeUndefined();
      });
    });

    describe('stepCompleted', () => {
      it('queues step event with timing', () => {
        analytics.stepCompleted('detect_framework', 150, true);

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'step',
            sessionId: 'test-session-id-123',
            name: 'detect_framework',
            durationMs: 150,
            success: true,
          }),
        );
      });

      it('includes error info on failure', () => {
        const error = new TypeError('Detection failed');
        analytics.stepCompleted('detect_framework', 50, false, error);

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'step',
            success: false,
            error: {
              type: 'TypeError',
              message: 'Detection failed',
            },
          }),
        );
      });

      it('omits error field on success', () => {
        analytics.stepCompleted('install_sdk', 2000, true);

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'step')[0];
        expect(event.error).toBeUndefined();
      });

      it('includes startTimestamp as valid ISO 8601', () => {
        analytics.stepCompleted('detect_framework', 150, true);

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'step')[0];
        expect(event.startTimestamp).toBeDefined();
        expect(new Date(event.startTimestamp).toISOString()).toBe(event.startTimestamp);
      });
    });

    describe('toolCalled', () => {
      it('queues agent.tool event', () => {
        analytics.toolCalled('Write', 50, true);

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent.tool',
            sessionId: 'test-session-id-123',
            toolName: 'Write',
            durationMs: 50,
            success: true,
          }),
        );
      });

      it('records failed tool calls', () => {
        analytics.toolCalled('Bash', 100, false);

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent.tool',
            toolName: 'Bash',
            success: false,
          }),
        );
      });

      it('includes startTimestamp as valid ISO 8601', () => {
        analytics.toolCalled('Write', 50, true);

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'agent.tool')[0];
        expect(event.startTimestamp).toBeDefined();
        expect(new Date(event.startTimestamp).toISOString()).toBe(event.startTimestamp);
      });
    });

    describe('llmRequest', () => {
      it('queues agent.llm event with token counts', () => {
        analytics.llmRequest('claude-sonnet-4-20250514', 1000, 500);

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'agent.llm',
            sessionId: 'test-session-id-123',
            model: 'claude-sonnet-4-20250514',
            inputTokens: 1000,
            outputTokens: 500,
          }),
        );
      });

      it('does NOT include startTimestamp (point-in-time marker)', () => {
        analytics.llmRequest('claude-sonnet-4-20250514', 1000, 500);

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'agent.llm')[0];
        expect(event.startTimestamp).toBeUndefined();
      });

      it('accumulates tokens for session.end', async () => {
        analytics.llmRequest('claude-sonnet-4-20250514', 1000, 500);
        analytics.llmRequest('claude-sonnet-4-20250514', 800, 300);

        await analytics.shutdown('success');

        const sessionEnd = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(sessionEnd.attributes['installer.agent.tokens.input']).toBe(1800);
        expect(sessionEnd.attributes['installer.agent.tokens.output']).toBe(800);
      });
    });

    describe('incrementAgentIterations', () => {
      it('tracks iterations in session.end', async () => {
        analytics.incrementAgentIterations();
        analytics.incrementAgentIterations();
        analytics.incrementAgentIterations();

        await analytics.shutdown('success');

        const sessionEnd = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(sessionEnd.attributes['installer.agent.iterations']).toBe(3);
      });
    });

    describe('emitCommandEvent', () => {
      it('queues a command event with name, duration, success, and flags', () => {
        analytics.emitCommandEvent('organization.list', 150, true, { flags: ['json'] });

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'command',
            attributes: expect.objectContaining({
              'command.name': 'organization.list',
              'command.duration_ms': 150,
              'command.success': true,
              'command.flags': 'json',
              'cli.version': expect.any(String),
              'env.os': expect.any(String),
              'device.id': TEST_DEVICE_ID,
            }),
          }),
        );
      });

      it('includes termination.reason when provided', () => {
        analytics.emitCommandEvent('auth.login', 50, false, {
          reason: 'auth_required',
          errorCode: 'auth_required',
        });

        const event = mockQueueEvent.mock.calls.find((c: any) => c[0].type === 'command')[0];
        expect(event.attributes['termination.reason']).toBe('auth_required');
        expect(event.attributes['error.code']).toBe('auth_required');
        expect(event.attributes['command.success']).toBe(false);
      });

      it('includes error info when provided', () => {
        const error = new TypeError('Not found');
        analytics.emitCommandEvent('org.get', 50, false, { error });

        const event = mockQueueEvent.mock.calls.find((c: any) => c[0].type === 'command')[0];
        expect(event.attributes['command.error_type']).toBe('TypeError');
        expect(event.attributes['command.error_message']).toBe('Not found');
      });

      it('includes apiContext when provided', () => {
        analytics.emitCommandEvent('org.get', 50, false, {
          reason: 'api_error',
          apiContext: { status: 500, code: 'internal_server_error', resource: 'organizations' },
        });

        const event = mockQueueEvent.mock.calls.find((c: any) => c[0].type === 'command')[0];
        expect(event.attributes['api.status']).toBe(500);
        expect(event.attributes['api.code']).toBe('internal_server_error');
        expect(event.attributes['api.resource']).toBe('organizations');
      });

      it('omits optional fields when not provided', () => {
        analytics.emitCommandEvent('doctor', 100, true);

        const event = mockQueueEvent.mock.calls.find((c: any) => c[0].type === 'command')[0];
        expect(event.attributes['command.flags']).toBeUndefined();
        expect(event.attributes['command.error_type']).toBeUndefined();
        expect(event.attributes['termination.reason']).toBeUndefined();
        expect(event.attributes['api.status']).toBeUndefined();
      });
    });

    describe('captureUnhandledCrash', () => {
      it('queues a crash event with error details', () => {
        const error = new Error('Unexpected failure');
        error.stack = 'Error: Unexpected failure\n    at foo.ts:1';
        analytics.captureUnhandledCrash(error, { command: 'install', version: '1.0.0' });

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'crash',
            attributes: expect.objectContaining({
              'crash.error_type': 'Error',
              'crash.error_message': 'Unexpected failure',
              'crash.stack': 'Error: Unexpected failure\n    at foo.ts:1',
              'crash.command': 'install',
              'cli.version': '1.0.0',
              'env.os': expect.any(String),
              'env.node_version': expect.any(String),
            }),
          }),
        );
      });

      it('truncates stack traces to 4KB with a truncation marker', () => {
        const error = new Error('Big stack');
        error.stack = 'x'.repeat(5000);
        analytics.captureUnhandledCrash(error);

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'crash')[0];
        // sanitizeStack truncates so the result (marker included) stays within
        // the API's 4096-char per-attribute cap; an over-length value would be
        // rejected by Zod and the whole crash event silently dropped.
        expect(event.attributes['crash.stack']).toMatch(/\n\.\.\.\[truncated\]$/);
        expect(event.attributes['crash.stack'].length).toBeLessThanOrEqual(4096);
        expect(event.attributes['crash.stack'].startsWith('x')).toBe(true);
      });

      it('falls back to package version when not explicitly provided', () => {
        analytics.captureUnhandledCrash(new Error('test'));

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'crash')[0];
        // Falls back to getVersion() which reads from package.json — any real version string
        expect(event.attributes['cli.version']).toEqual(expect.any(String));
        expect(event.attributes['cli.version']).not.toBe('');
      });
    });

    describe('initForNonInstaller', () => {
      it('sets gatewayUrl from default config', () => {
        mockGetTelemetryUrl.mockReturnValue('https://api.workos.com/cli');
        analytics.initForNonInstaller();

        expect(mockSetGatewayUrl).toHaveBeenCalledWith('https://api.workos.com/cli');
      });

      it('sets access token from stored credentials', () => {
        mockGetCredentials.mockReturnValue({ accessToken: 'stored-jwt-token' });
        analytics.initForNonInstaller();

        expect(mockSetAccessToken).toHaveBeenCalledWith('stored-jwt-token');
      });

      it('skips access token when no credentials stored', () => {
        mockGetCredentials.mockReturnValue(null);
        analytics.initForNonInstaller();

        expect(mockSetAccessToken).not.toHaveBeenCalled();
      });
    });

    describe('auth.mode derivation', () => {
      const readAuthMode = () => {
        analytics.emitCommandEvent('test', 0, true);
        const event = mockQueueEvent.mock.calls.find((c: any) => c[0].type === 'command')[0];
        return event.attributes['auth.mode'];
      };

      it('derives jwt when stored credentials have an access token', () => {
        mockGetCredentials.mockReturnValue({ accessToken: 'jwt-token', userId: 'user-1' });
        analytics.initForNonInstaller();

        expect(readAuthMode()).toBe('jwt');
      });

      it('derives claim_token when only an unclaimed environment is active', () => {
        mockGetCredentials.mockReturnValue(null);
        mockGetActiveEnvironment.mockReturnValue({
          type: 'unclaimed',
          name: 'dev',
          apiKey: 'sk_test',
          clientId: 'client_123',
          claimToken: 'claim_tok',
        });
        analytics.initForNonInstaller();

        expect(mockSetClaimTokenAuth).toHaveBeenCalledWith('client_123', 'claim_tok');
        expect(readAuthMode()).toBe('claim_token');
      });

      it('derives api_key when only WORKOS_API_KEY is set', () => {
        mockGetCredentials.mockReturnValue(null);
        mockGetActiveEnvironment.mockReturnValue(null);
        process.env.WORKOS_API_KEY = 'sk_live_abc';
        analytics.initForNonInstaller();

        expect(mockSetApiKeyAuth).toHaveBeenCalledWith('sk_live_abc');
        expect(readAuthMode()).toBe('api_key');
      });

      it('derives api_key from a claimed active environment', () => {
        mockGetCredentials.mockReturnValue(null);
        mockGetActiveEnvironment.mockReturnValue({
          type: 'sandbox',
          name: 'dev',
          apiKey: 'sk_test_active',
          clientId: 'client_123',
        });
        analytics.initForNonInstaller();

        expect(mockSetApiKeyAuth).toHaveBeenCalledWith('sk_test_active');
        expect(readAuthMode()).toBe('api_key');
      });

      it('derives none when no credentials are available', () => {
        mockGetCredentials.mockReturnValue(null);
        mockGetActiveEnvironment.mockReturnValue(null);
        analytics.initForNonInstaller();

        expect(readAuthMode()).toBe('none');
      });

      it('prefers jwt over claim_token when both are present', () => {
        mockGetCredentials.mockReturnValue({ accessToken: 'jwt-token' });
        mockGetActiveEnvironment.mockReturnValue({
          type: 'unclaimed',
          name: 'dev',
          apiKey: 'sk_test',
          clientId: 'client_123',
          claimToken: 'claim_tok',
        });
        analytics.initForNonInstaller();

        expect(readAuthMode()).toBe('jwt');
      });

      it('prefers claim_token over api_key when both are present', () => {
        mockGetCredentials.mockReturnValue(null);
        mockGetActiveEnvironment.mockReturnValue({
          type: 'unclaimed',
          name: 'dev',
          apiKey: 'sk_test',
          clientId: 'client_123',
          claimToken: 'claim_tok',
        });
        process.env.WORKOS_API_KEY = 'sk_live_abc';
        analytics.initForNonInstaller();

        expect(readAuthMode()).toBe('claim_token');
      });

      it('can be overridden by setAuthMode (installer flow)', () => {
        analytics.setAuthMode('api_key');
        expect(readAuthMode()).toBe('api_key');
      });

      it('falls through to api_key when the stored JWT is expired', () => {
        // Logged-in user whose 5-min access token has lapsed, but a valid
        // active-environment API key is available. The expired JWT must NOT
        // be used (it would 401 and the telemetry event would be dropped).
        mockGetCredentials.mockReturnValue({
          accessToken: 'expired-jwt',
          userId: 'user-1',
          expiresAt: Date.now() - 1000,
        });
        mockGetActiveEnvironment.mockReturnValue({
          type: 'sandbox',
          name: 'dev',
          apiKey: 'sk_test_active',
          clientId: 'client_123',
        });
        analytics.initForNonInstaller();

        expect(mockSetAccessToken).not.toHaveBeenCalled();
        expect(mockSetApiKeyAuth).toHaveBeenCalledWith('sk_test_active');
        expect(readAuthMode()).toBe('api_key');
      });
    });

    describe('device.id and auth.mode on events', () => {
      it('includes device.id on session.start events', () => {
        analytics.sessionStart('cli', '1.0.0');
        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.start')[0];
        expect(event.attributes['device.id']).toBe(TEST_DEVICE_ID);
        expect(event.attributes['device.id']).toMatch(/^[0-9a-f-]{36}$/i);
      });

      it('includes device.id and auth.mode on command events', () => {
        analytics.emitCommandEvent('org.list', 0, true);
        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'command')[0];
        expect(event.attributes['device.id']).toBe(TEST_DEVICE_ID);
        expect(event.attributes['auth.mode']).toBe('none');
      });

      it('includes device.id and auth.mode on crash events', () => {
        analytics.captureUnhandledCrash(new Error('boom'));
        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'crash')[0];
        expect(event.attributes['device.id']).toBe(TEST_DEVICE_ID);
        expect(event.attributes['auth.mode']).toBe('none');
      });

      it('includes device.id and auth.mode on session.end events', async () => {
        await analytics.shutdown('success');
        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'session.end')[0];
        expect(event.attributes['device.id']).toBe(TEST_DEVICE_ID);
        expect(event.attributes['auth.mode']).toBe('none');
      });
    });
  });

  describe('with telemetry disabled', () => {
    beforeEach(async () => {
      process.env.WORKOS_TELEMETRY = 'false';
      vi.resetModules();
      vi.doMock('./telemetry-client.js', () => ({
        telemetryClient: {
          setGatewayUrl: mockSetGatewayUrl,
          setAccessToken: mockSetAccessToken,
          setClaimTokenAuth: mockSetClaimTokenAuth,
          setApiKeyAuth: mockSetApiKeyAuth,
          queueEvent: mockQueueEvent,
          flush: mockFlush,
        },
      }));
      vi.doMock('../lib/settings.js', () => ({
        getTelemetryUrl: () => mockGetTelemetryUrl(),
        getConfig: () => mockSettingsConfig,
        getVersion: () => '0.12.1',
      }));
      vi.doMock('../lib/credentials.js', () => ({
        getCredentials: () => mockGetCredentials(),
        isTokenExpired: (creds: { expiresAt: number }) => Date.now() >= creds.expiresAt,
      }));
      vi.doMock('../lib/device-id.js', () => ({
        getDeviceId: () => TEST_DEVICE_ID,
      }));
      vi.doMock('../lib/config-store.js', () => ({
        getActiveEnvironment: () => mockGetActiveEnvironment(),
        isUnclaimedEnvironment: (env: { type: string }) => env?.type === 'unclaimed',
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

    it('stepCompleted does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.stepCompleted('test_step', 100, true);

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('toolCalled does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.toolCalled('Write', 50, true);

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('llmRequest does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.llmRequest('claude-sonnet-4-20250514', 1000, 500);

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('emitCommandEvent does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();
      analytics.emitCommandEvent('org.list', 100, true);
      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('captureUnhandledCrash does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.captureUnhandledCrash(new Error('test'));

      expect(mockQueueEvent).not.toHaveBeenCalled();
    });

    it('initForNonInstaller does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.initForNonInstaller();

      expect(mockSetGatewayUrl).not.toHaveBeenCalled();
    });
  });
});
