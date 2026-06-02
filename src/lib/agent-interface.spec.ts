import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockQuery, mockConfig } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockConfig: {
    model: 'test-model',
    workos: {
      clientId: 'client_test',
      authkitDomain: 'test.workos.com',
      llmGatewayUrl: 'http://localhost:8000',
      telemetryUrl: 'http://localhost:8000/cli',
    },
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
  startClaimTokenProxy: vi.fn(),
}));

vi.mock('./config-store.js', () => ({
  getActiveEnvironment: vi.fn(() => null),
  isUnclaimedEnvironment: vi.fn(() => false),
}));

vi.mock('../utils/urls.js', () => ({
  getLlmGatewayUrlFromHost: vi.fn(() => 'http://localhost:8000'),
}));

import { runAgent, AgentErrorType, initializeAgent, type AgentConfig } from './agent-interface.js';
import { startCredentialProxy, startClaimTokenProxy } from './credential-proxy.js';
import { getActiveEnvironment, isUnclaimedEnvironment } from './config-store.js';
import { hasCredentials, getCredentials } from './credentials.js';
import { InstallerEventEmitter } from './events.js';
import type { InstallerOptions } from '../utils/types.js';

/**
 * Create a mock SDK response that consumes the prompt stream and yields
 * responses for each prompt message. This models the real SDK behavior:
 * the response generator stays alive as long as prompts keep coming.
 *
 * Turn options:
 * - text: assistant text to yield
 * - error: result subtype is 'error' with errors array
 * - is_error: result has subtype 'success' but is_error: true (SDK exhausted retries)
 */
function createMockSDKResponse(turns: Array<{ text?: string; error?: boolean; is_error?: boolean }>) {
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
          is_error: turn.is_error ?? false,
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

describe('service unavailability handling', () => {
  let emitter: InstallerEventEmitter;
  let emittedEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    mockQuery.mockReset();
    emitter = new InstallerEventEmitter();
    emittedEvents = [];

    const originalEmit = emitter.emit.bind(emitter);
    emitter.emit = ((event: string, payload: unknown) => {
      emittedEvents.push({ event, payload });
      return originalEmit(event, payload);
    }) as typeof emitter.emit;
  });

  it('detects is_error result with API 500 as SERVICE_UNAVAILABLE', async () => {
    const apiErrorText = 'API Error: 500 {"error":{"type":"internal_error","message":"An unexpected error occurred"}}';
    mockQuery.mockImplementation(createMockSDKResponse([{ text: apiErrorText, is_error: true }]));

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter);

    expect(result.error).toBe(AgentErrorType.SERVICE_UNAVAILABLE);
    expect(result.errorMessage).toMatch(/temporarily unavailable/);
  });

  it('detects is_error result with server_error as SERVICE_UNAVAILABLE', async () => {
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'server_error: service overloaded', is_error: true }]));

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter);

    expect(result.error).toBe(AgentErrorType.SERVICE_UNAVAILABLE);
  });

  it('detects is_error result without service pattern as EXECUTION_ERROR', async () => {
    mockQuery.mockImplementation(createMockSDKResponse([{ text: 'Some other failure', is_error: true }]));

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter);

    expect(result.error).toBe(AgentErrorType.EXECUTION_ERROR);
    expect(result.errorMessage).toBe('Some other failure');
  });

  it('skips validation retries when service is unavailable', async () => {
    const apiErrorText = 'API Error: 500 {"error":{"type":"internal_error","message":"An unexpected error occurred"}}';
    mockQuery.mockImplementation(createMockSDKResponse([{ text: apiErrorText, is_error: true }]));

    const validateAndFormat = vi.fn().mockResolvedValue('Still broken');

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 2,
      validateAndFormat,
    });

    expect(result.error).toBe(AgentErrorType.SERVICE_UNAVAILABLE);
    // validateAndFormat should never be called because retries are aborted
    expect(validateAndFormat).not.toHaveBeenCalled();

    // No retry events should be emitted
    const retryEvents = emittedEvents.filter((e) => e.event === 'agent:retry');
    expect(retryEvents).toHaveLength(0);
  });

  it('detects 429 rate limit as distinct from service unavailability', async () => {
    mockQuery.mockImplementation(
      createMockSDKResponse([{ text: 'API Error: 429 rate_limit_exceeded', is_error: true }]),
    );

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter);

    expect(result.error).toBe(AgentErrorType.SERVICE_UNAVAILABLE);
    expect(result.errorMessage).toMatch(/rate-limited/);
    expect(result.errorMessage).not.toMatch(/temporarily unavailable/);
  });

  it('skips validation retries when rate-limited', async () => {
    mockQuery.mockImplementation(
      createMockSDKResponse([{ text: 'API Error: 429 rate_limit_exceeded', is_error: true }]),
    );

    const validateAndFormat = vi.fn().mockResolvedValue('Still broken');

    const result = await runAgent(makeAgentConfig(), 'Test prompt', makeOptions(), undefined, emitter, {
      maxRetries: 2,
      validateAndFormat,
    });

    expect(result.error).toBe(AgentErrorType.SERVICE_UNAVAILABLE);
    expect(result.errorMessage).toMatch(/rate-limited/);
    expect(validateAndFormat).not.toHaveBeenCalled();
  });
});

describe('initializeAgent sdkEnv auth', () => {
  const PROXY_PLACEHOLDER_TOKEN = 'workos-cli-proxy-placeholder';
  const originalAnthropicApiKey = process.env.ANTHROPIC_API_KEY;
  const originalAnthropicAuthToken = process.env.ANTHROPIC_AUTH_TOKEN;

  beforeEach(() => {
    vi.mocked(startCredentialProxy).mockReset();
    vi.mocked(startClaimTokenProxy).mockReset();
    vi.mocked(getActiveEnvironment).mockReset().mockReturnValue(null);
    vi.mocked(isUnclaimedEnvironment).mockReset().mockReturnValue(false);
    vi.mocked(hasCredentials).mockReset().mockReturnValue(false);
    vi.mocked(getCredentials).mockReset().mockReturnValue(null);

    // Simulate a user shell that has their own Anthropic key sitting in the
    // environment. The SDK must NOT forward this to the WorkOS gateway.
    process.env.ANTHROPIC_API_KEY = 'sk-ant-user-personal-key';
    delete process.env.ANTHROPIC_AUTH_TOKEN;
  });

  afterEach(() => {
    if (originalAnthropicApiKey === undefined) {
      delete process.env.ANTHROPIC_API_KEY;
    } else {
      process.env.ANTHROPIC_API_KEY = originalAnthropicApiKey;
    }
    if (originalAnthropicAuthToken === undefined) {
      delete process.env.ANTHROPIC_AUTH_TOKEN;
    } else {
      process.env.ANTHROPIC_AUTH_TOKEN = originalAnthropicAuthToken;
    }
  });

  function makeAgentConfigForInit(): AgentConfig {
    return {
      workingDirectory: '/tmp/test',
      workOSApiKey: 'sk_test_x',
      workOSApiHost: 'https://api.workos.com',
    };
  }

  it('seeds placeholder auth token on the credential proxy path', async () => {
    vi.mocked(hasCredentials).mockReturnValue(true);
    vi.mocked(getCredentials).mockReturnValue({
      accessToken: 'real-workos-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60_000,
      userId: 'user_x',
    });
    vi.mocked(startCredentialProxy).mockResolvedValue({
      port: 12345,
      url: 'http://127.0.0.1:12345',
      stop: vi.fn(async () => {}),
    });

    const result = await initializeAgent(makeAgentConfigForInit(), makeOptions({ skipAuth: false, local: false }));

    // The SDK runs a local auth-source check at startup and exits with
    // "Not logged in" if nothing is present. A placeholder token prevents
    // that false-positive; the proxy overwrites Authorization upstream.
    expect(result.sdkEnv.ANTHROPIC_AUTH_TOKEN).toBe(PROXY_PLACEHOLDER_TOKEN);
    // User's personal Anthropic key must not leak through to the gateway.
    expect(result.sdkEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.sdkEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:12345');
  });

  it('seeds placeholder auth token on the claim-token proxy path', async () => {
    vi.mocked(getActiveEnvironment).mockReturnValue({
      apiKey: 'sk_test_x',
      clientId: 'client_x',
      claimToken: 'claim_xyz',
    } as unknown as ReturnType<typeof getActiveEnvironment>);
    vi.mocked(isUnclaimedEnvironment).mockReturnValue(true);
    vi.mocked(startClaimTokenProxy).mockResolvedValue({
      port: 23456,
      url: 'http://127.0.0.1:23456',
      stop: vi.fn(async () => {}),
    });

    const result = await initializeAgent(makeAgentConfigForInit(), makeOptions({ skipAuth: false, local: false }));

    expect(result.sdkEnv.ANTHROPIC_AUTH_TOKEN).toBe(PROXY_PLACEHOLDER_TOKEN);
    expect(result.sdkEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(result.sdkEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:23456');
  });

  it('seeds placeholder auth token in skip-auth mode', async () => {
    const result = await initializeAgent(makeAgentConfigForInit(), makeOptions({ skipAuth: true, local: false }));

    expect(result.sdkEnv.ANTHROPIC_AUTH_TOKEN).toBe(PROXY_PLACEHOLDER_TOKEN);
    expect(result.sdkEnv.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('seeds placeholder auth token in local mode', async () => {
    const result = await initializeAgent(makeAgentConfigForInit(), makeOptions({ skipAuth: false, local: true }));

    expect(result.sdkEnv.ANTHROPIC_AUTH_TOKEN).toBe(PROXY_PLACEHOLDER_TOKEN);
    expect(result.sdkEnv.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('strips ANTHROPIC_API_KEY on legacy fallback path (no refresh token)', async () => {
    vi.mocked(hasCredentials).mockReturnValue(true);
    // No refreshToken - triggers the legacy fallback branch in initializeAgent.
    vi.mocked(getCredentials).mockReturnValue({
      accessToken: 'real-workos-token',
      expiresAt: Date.now() + 60_000,
      userId: 'user_x',
    });

    const result = await initializeAgent(makeAgentConfigForInit(), makeOptions({ skipAuth: false, local: false }));

    // Legacy path sends the real WorkOS access token as the bearer; the
    // user's personal Anthropic key must not tag along as an x-api-key
    // header to the WorkOS gateway.
    expect(result.sdkEnv.ANTHROPIC_AUTH_TOKEN).toBe('real-workos-token');
    expect(result.sdkEnv.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('preserves ANTHROPIC_API_KEY in direct mode', async () => {
    const result = await initializeAgent(
      makeAgentConfigForInit(),
      makeOptions({ direct: true, skipAuth: false, local: false }),
    );

    // Direct mode talks to api.anthropic.com using the user's own key;
    // the placeholder bearer must NOT be set here.
    expect(result.sdkEnv.ANTHROPIC_API_KEY).toBe('sk-ant-user-personal-key');
    expect(result.sdkEnv.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(result.sdkEnv.ANTHROPIC_BASE_URL).toBeUndefined();
  });
});
