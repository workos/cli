import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const { mockQuery, mockConfig } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConfig: {
    model: 'test-model',
    workos: { clientId: 'client_test', authkitDomain: 'test.workos.com', llmGatewayUrl: 'http://localhost:8000' },
    telemetry: { enabled: false, eventName: 'test_event' },
    proxy: { refreshThresholdMs: 300000 },
    nodeVersion: '20',
    logging: { debugMode: false },
    documentation: {
      workosDocsUrl: 'https://workos.com/docs',
      dashboardUrl: 'https://dashboard.workos.com',
      issuesUrl: 'https://github.com',
    },
    frameworks: {},
    legacy: { oauthPort: 3000 },
    branding: { showAsciiArt: false, asciiArt: '', compactAsciiArt: '', useCompact: false },
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
}));

vi.mock('../utils/debug.js', () => ({
  debug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
  initLogFile: vi.fn(),
  getLogFilePath: vi.fn(() => null),
}));

vi.mock('../utils/analytics.js', () => ({
  analytics: {
    capture: vi.fn(),
    setTag: vi.fn(),
    shutdown: vi.fn(),
    llmRequest: vi.fn(),
    incrementAgentIterations: vi.fn(),
    toolCalled: vi.fn(),
  },
}));

vi.mock('./settings.js', () => ({
  getConfig: vi.fn(() => mockConfig),
  getAuthkitDomain: vi.fn(() => 'test.workos.com'),
  getCliAuthClientId: vi.fn(() => 'client_test'),
}));

vi.mock('./credentials.js', () => ({
  hasCredentials: vi.fn(() => false),
  getCredentials: vi.fn(() => null),
}));

vi.mock('./token-refresh.js', () => ({
  ensureValidToken: vi.fn(async () => ({ success: true })),
}));

vi.mock('./credential-proxy.js', () => ({
  startCredentialProxy: vi.fn(),
}));

vi.mock('../utils/urls.js', () => ({
  getLlmGatewayUrlFromHost: vi.fn(() => 'http://localhost:8000'),
}));

import { runAgent, type RetryConfig } from './agent-interface.js';
import { InstallerEventEmitter } from './events.js';
import type { InstallerOptions } from '../utils/types.js';

/**
 * Create a mock SDK response that consumes the prompt stream and yields
 * responses for each prompt message. This models the real SDK behavior:
 * the response generator stays alive as long as prompts keep coming.
 */
function createMockSDKResponse(turns: Array<{ text?: string; error?: boolean }>) {
  return function mockQueryImpl({ prompt }: { prompt: AsyncIterable<unknown>; options: unknown }) {
    let turnIndex = 0;

    async function* responseGenerator() {
      // Consume each prompt message and respond with the corresponding turn
      for await (const _promptMsg of prompt) {
        if (turnIndex >= turns.length) continue;

        const turn = turns[turnIndex];
        turnIndex++;

        if (turn.text) {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: turn.text }],
              usage: { input_tokens: 100, output_tokens: 50 },
              model: 'test-model',
            },
          };
        }

        yield {
          type: 'result',
          subtype: turn.error ? 'error' : 'success',
          result: turn.text ?? '',
          ...(turn.error ? { errors: ['Test error'] } : {}),
        };
      }
    }

    return responseGenerator();
  };
}

function makeAgentConfig() {
  return {
    workingDirectory: '/tmp/test',
    mcpServers: {},
    model: 'test-model',
    allowedTools: [],
    sdkEnv: {},
  };
}

function makeOptions(overrides: Partial<InstallerOptions> = {}): InstallerOptions {
  return {
    debug: false,
    forceInstall: false,
    installDir: '/tmp/test',
    local: true,
    ci: false,
    skipAuth: true,
    ...overrides,
  };
}

describe('runAgent retry loop', () => {
  let emitter: InstallerEventEmitter;
  let emittedEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    mockQuery.mockReset();
    emitter = new InstallerEventEmitter();
    emittedEvents = [];

    // Capture all events
    const originalEmit = emitter.emit.bind(emitter);
    emitter.emit = ((event: string, payload: unknown) => {
      emittedEvents.push({ event, payload });
      return originalEmit(event, payload);
    }) as typeof emitter.emit;
  });

  it('returns retryCount=0 when no retryConfig provided', async () => {
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'Done!' }]));

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter);

    expect(result.error).toBeUndefined();
    expect(result.retryCount).toBe(0);
  });

  it('returns retryCount=0 when validation passes first try', async () => {
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'Done!' }]));

    const validateAndFormat = vi.fn().mockResolvedValue(null); // passes

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 2,
      validateAndFormat,
    });

    expect(result.error).toBeUndefined();
    expect(result.retryCount).toBe(0);
    expect(validateAndFormat).toHaveBeenCalledTimes(1);

    // Should emit validation:retry:start and validation:retry:complete
    const retryStartEvents = emittedEvents.filter((e) => e.event === 'validation:retry:start');
    const retryCompleteEvents = emittedEvents.filter((e) => e.event === 'validation:retry:complete');
    expect(retryStartEvents).toHaveLength(1);
    expect(retryCompleteEvents).toHaveLength(1);
    expect(retryCompleteEvents[0].payload).toEqual({ attempt: 1, passed: true });

    // Should NOT emit agent:retry (no retry happened)
    const retryEvents = emittedEvents.filter((e) => e.event === 'agent:retry');
    expect(retryEvents).toHaveLength(0);
  });

  it('retries once when validation fails then passes', async () => {
    // Two turns: initial + one retry
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'Initial attempt' }, { text: 'Fixed it!' }]));

    const validateAndFormat = vi
      .fn()
      .mockResolvedValueOnce('Type error in src/foo.ts') // fail first
      .mockResolvedValueOnce(null); // pass second

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 2,
      validateAndFormat,
    });

    expect(result.error).toBeUndefined();
    expect(result.retryCount).toBe(1);
    expect(validateAndFormat).toHaveBeenCalledTimes(2);

    // Should emit agent:retry once
    const retryEvents = emittedEvents.filter((e) => e.event === 'agent:retry');
    expect(retryEvents).toHaveLength(1);
    expect(retryEvents[0].payload).toEqual({ attempt: 1, maxRetries: 2 });
  });

  it('caps at maxRetries when validation always fails', async () => {
    // Three turns: initial + 2 retries
    mockQuery.mockImplementation(
      createMockSDKResponse([{ text: 'Attempt 1' }, { text: 'Attempt 2' }, { text: 'Attempt 3' }]),
    );

    const validateAndFormat = vi.fn().mockResolvedValue('Still broken');

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 2,
      validateAndFormat,
    });

    expect(result.error).toBeUndefined();
    expect(result.retryCount).toBe(2);
    // Called 2 times: after initial + after retry 1
    // NOT called after retry 2 because the loop exits
    expect(validateAndFormat).toHaveBeenCalledTimes(2);

    const retryEvents = emittedEvents.filter((e) => e.event === 'agent:retry');
    expect(retryEvents).toHaveLength(2);
  });

  it('preserves existing behavior with maxRetries=0', async () => {
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'Done!' }]));

    const validateAndFormat = vi.fn().mockResolvedValue('Error');

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 0,
      validateAndFormat,
    });

    expect(result.error).toBeUndefined();
    expect(result.retryCount).toBe(0);
    // validateAndFormat should never be called with maxRetries=0
    expect(validateAndFormat).not.toHaveBeenCalled();
  });

  it('treats validateAndFormat errors as passed', async () => {
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'Done!' }]));

    const validateAndFormat = vi.fn().mockRejectedValue(new Error('Validation crashed'));

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 2,
      validateAndFormat,
    });

    expect(result.error).toBeUndefined();
    expect(result.retryCount).toBe(0);
    // Should have been called once, threw, treated as passed
    expect(validateAndFormat).toHaveBeenCalledTimes(1);
  });
});
