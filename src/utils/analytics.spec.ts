import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock telemetry client
const mockSetGatewayUrl = vi.fn();
const mockSetAccessToken = vi.fn();
const mockQueueEvent = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);
const mockReplaceLastEventOfType = vi.fn();

vi.mock('./telemetry-client.js', () => ({
  telemetryClient: {
    setGatewayUrl: mockSetGatewayUrl,
    setAccessToken: mockSetAccessToken,
    queueEvent: mockQueueEvent,
    flush: mockFlush,
    replaceLastEventOfType: (...args: unknown[]) => mockReplaceLastEventOfType(...args),
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

// Mock settings for initForNonInstaller
const mockGetLlmGatewayUrl = vi.fn(() => 'https://api.workos.com/llm-gateway');
const mockSettingsConfig = {
  nodeVersion: '>=18',
  logging: { debugMode: false },
  telemetry: { enabled: true, eventName: 'installer_interaction' },
  documentation: { workosDocsUrl: 'https://workos.com/docs', dashboardUrl: 'https://dashboard.workos.com', issuesUrl: 'https://github.com' },
  legacy: { oauthPort: 3000 },
};
vi.mock('../lib/settings.js', () => ({
  getLlmGatewayUrl: () => mockGetLlmGatewayUrl(),
  getConfig: () => mockSettingsConfig,
  getVersion: () => '0.12.1',
}));

// Mock credentials for initForNonInstaller
const mockGetCredentials = vi.fn();
vi.mock('../lib/credentials.js', () => ({
  getCredentials: () => mockGetCredentials(),
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
          queueEvent: mockQueueEvent,
          flush: mockFlush,
          replaceLastEventOfType: (...args: unknown[]) => mockReplaceLastEventOfType(...args),
        },
      }));
      vi.doMock('../lib/settings.js', () => ({
        getLlmGatewayUrl: () => mockGetLlmGatewayUrl(),
        getConfig: () => mockSettingsConfig,
        getVersion: () => '0.12.1',
      }));
      vi.doMock('../lib/credentials.js', () => ({
        getCredentials: () => mockGetCredentials(),
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

    describe('commandExecuted', () => {
      it('queues a command event with correct attributes', () => {
        analytics.commandExecuted('org.list', 200, true);

        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'command',
            attributes: expect.objectContaining({
              'command.name': 'org.list',
              'command.duration_ms': 200,
              'command.success': true,
              'env.os': expect.any(String),
              'env.node_version': expect.any(String),
            }),
          }),
        );
      });

      it('includes error info when provided', () => {
        const error = new TypeError('Not found');
        analytics.commandExecuted('org.get', 50, false, { error });

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'command')[0];
        expect(event.attributes['command.error_type']).toBe('TypeError');
        expect(event.attributes['command.error_message']).toBe('Not found');
      });

      it('includes flags as comma-separated names', () => {
        analytics.commandExecuted('org.list', 100, true, { flags: ['json', 'limit'] });

        const event = mockQueueEvent.mock.calls.find((c) => c[0].type === 'command')[0];
        expect(event.attributes['command.flags']).toBe('json,limit');
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
        // sanitizeStack truncates at 4096 and appends '\n...[truncated]'
        expect(event.attributes['crash.stack']).toMatch(/\n\.\.\.\[truncated\]$/);
        expect(event.attributes['crash.stack'].startsWith('x'.repeat(4096))).toBe(true);
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
        mockGetLlmGatewayUrl.mockReturnValue('https://api.workos.com/llm-gateway');
        analytics.initForNonInstaller();

        expect(mockSetGatewayUrl).toHaveBeenCalledWith('https://api.workos.com/llm-gateway');
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

    describe('replaceLastCommandEvent', () => {
      it('removes last command event and queues a new one', () => {
        analytics.replaceLastCommandEvent('organization.list', 150, true, { flags: ['json'] });

        expect(mockReplaceLastEventOfType).toHaveBeenCalledWith('command');
        expect(mockQueueEvent).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'command',
            attributes: expect.objectContaining({
              'command.name': 'organization.list',
              'command.duration_ms': 150,
              'command.success': true,
              'command.flags': 'json',
            }),
          }),
        );
      });

      it('includes error info on failure', () => {
        const error = new Error('oops');
        error.name = 'CommandError';
        analytics.replaceLastCommandEvent('auth.login', 50, false, { error });

        const event = mockQueueEvent.mock.calls[0][0];
        expect(event.attributes['command.success']).toBe(false);
        expect(event.attributes['command.error_type']).toBe('CommandError');
        expect(event.attributes['command.error_message']).toBe('oops');
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
          queueEvent: mockQueueEvent,
          flush: mockFlush,
          replaceLastEventOfType: (...args: unknown[]) => mockReplaceLastEventOfType(...args),
        },
      }));
      vi.doMock('../lib/settings.js', () => ({
        getLlmGatewayUrl: () => mockGetLlmGatewayUrl(),
        getConfig: () => mockSettingsConfig,
        getVersion: () => '0.12.1',
      }));
      vi.doMock('../lib/credentials.js', () => ({
        getCredentials: () => mockGetCredentials(),
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

    it('commandExecuted does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.commandExecuted('org.list', 100, true);

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

    it('replaceLastCommandEvent does nothing', async () => {
      const { Analytics } = await import('./analytics.js');
      const analytics = new Analytics();

      analytics.replaceLastCommandEvent('org.list', 100, true);

      expect(mockReplaceLastEventOfType).not.toHaveBeenCalled();
      expect(mockQueueEvent).not.toHaveBeenCalled();
    });
  });
});
