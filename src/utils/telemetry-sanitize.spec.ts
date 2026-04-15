import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { homedir } from 'node:os';
import { sanitizeMessage } from './crash-reporter.js';

// Mock telemetry client so we can inspect queued events without HTTP.
// Use vi.hoisted so these are available when the hoisted vi.mock factory runs
// (importing sanitizeMessage transitively loads analytics.ts which loads telemetry-client.ts).
const {
  mockSetGatewayUrl,
  mockSetAccessToken,
  mockQueueEvent,
  mockFlush,
  mockReplaceLastEventOfType,
} = vi.hoisted(() => ({
  mockSetGatewayUrl: vi.fn(),
  mockSetAccessToken: vi.fn(),
  mockQueueEvent: vi.fn(),
  mockFlush: vi.fn().mockResolvedValue(undefined),
  mockReplaceLastEventOfType: vi.fn(),
}));

vi.mock('./telemetry-client.js', () => ({
  telemetryClient: {
    setGatewayUrl: mockSetGatewayUrl,
    setAccessToken: mockSetAccessToken,
    queueEvent: mockQueueEvent,
    flush: mockFlush,
    replaceLastEventOfType: (...args: unknown[]) => mockReplaceLastEventOfType(...args),
  },
}));

vi.mock('./debug.js', () => ({
  debug: vi.fn(),
}));

vi.mock('uuid', () => ({
  v4: () => 'test-session-id-sanitize',
}));

vi.mock('../lib/settings.js', () => ({
  getLlmGatewayUrl: () => 'https://api.workos.com/llm-gateway',
  getConfig: () => ({
    nodeVersion: '>=18',
    logging: { debugMode: false },
    telemetry: { enabled: true, eventName: 'installer_interaction' },
    documentation: {
      workosDocsUrl: 'https://workos.com/docs',
      dashboardUrl: 'https://dashboard.workos.com',
      issuesUrl: 'https://github.com',
    },
    legacy: { oauthPort: 3000 },
  }),
  getVersion: () => '0.0.0-test',
}));

vi.mock('../lib/credentials.js', () => ({
  getCredentials: vi.fn(),
}));

describe('sanitizeMessage', () => {
  it('strips the home directory', () => {
    const home = homedir();
    const input = `ENOENT: no such file or directory, open '${home}/.workos/credentials.json'`;
    const out = sanitizeMessage(input);
    expect(out).not.toContain(home);
    expect(out).toContain('~/.workos/credentials.json');
  });

  it('redacts Bearer tokens', () => {
    const out = sanitizeMessage('401 Unauthorized: Bearer abc123.def456.ghi789 invalid');
    expect(out).not.toContain('abc123.def456.ghi789');
    expect(out).toContain('Bearer <redacted>');
  });

  it('redacts sk_live_ keys', () => {
    const out = sanitizeMessage('Authentication failed for sk_live_xyzABC123');
    expect(out).not.toContain('sk_live_xyzABC123');
    expect(out).toContain('sk_<redacted>');
  });

  it('redacts sk_test_ keys', () => {
    const out = sanitizeMessage('Bad key sk_test_qrsTUV456 in request');
    expect(out).not.toContain('sk_test_qrsTUV456');
    expect(out).toContain('sk_<redacted>');
  });

  it('redacts raw JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_value';
    const out = sanitizeMessage(`Token ${jwt} expired`);
    expect(out).not.toContain(jwt);
    expect(out).toContain('<jwt-redacted>');
  });

  it('truncates messages longer than 1024 chars with marker', () => {
    const long = 'a'.repeat(2000);
    const out = sanitizeMessage(long);
    expect(out.length).toBe(1024 + '...[truncated]'.length);
    expect(out.endsWith('...[truncated]')).toBe(true);
  });

  it('redacts before truncating so secrets near the boundary are not partially preserved', () => {
    // Place a JWT at position 1010 so its tail would fall past the 1024 cap.
    const padding = 'x'.repeat(1010);
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_value';
    const out = sanitizeMessage(padding + jwt);
    expect(out).not.toContain('signature_value');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('returns empty string for undefined or empty input', () => {
    expect(sanitizeMessage(undefined)).toBe('');
    expect(sanitizeMessage('')).toBe('');
  });

  it('redacts all marker types in a single string', () => {
    const home = homedir();
    const input = `${home}/x Bearer abc.def.ghi sk_live_ABC123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_value`;
    const out = sanitizeMessage(input);
    expect(out).not.toContain(home);
    expect(out).not.toContain('abc.def.ghi');
    expect(out).not.toContain('sk_live_ABC123');
    expect(out).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(out).toContain('~/x');
    expect(out).toContain('Bearer <redacted>');
    expect(out).toContain('sk_<redacted>');
    expect(out).toContain('<jwt-redacted>');
  });
});

describe('Analytics: no PII or secrets in queued events', () => {
  const home = homedir();
  const POISON_BEARER = 'abc123.def456.ghi789';
  const POISON_SK = 'sk_live_xyzABC123';
  const POISON_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature_value';
  const POISON_PATH = `${home}/.workos/credentials.json`;
  const POISON_MESSAGE = `ENOENT at ${POISON_PATH} Bearer ${POISON_BEARER} key=${POISON_SK} jwt=${POISON_JWT}`;

  let Analytics: typeof import('./analytics.js').Analytics;
  let analytics: InstanceType<typeof Analytics>;
  const originalEnv = process.env.WORKOS_TELEMETRY;

  beforeEach(async () => {
    vi.clearAllMocks();
    delete process.env.WORKOS_TELEMETRY;
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
      getLlmGatewayUrl: () => 'https://api.workos.com/llm-gateway',
      getConfig: () => ({
        nodeVersion: '>=18',
        logging: { debugMode: false },
        telemetry: { enabled: true, eventName: 'installer_interaction' },
        documentation: {
          workosDocsUrl: 'https://workos.com/docs',
          dashboardUrl: 'https://dashboard.workos.com',
          issuesUrl: 'https://github.com',
        },
        legacy: { oauthPort: 3000 },
      }),
      getVersion: () => '0.0.0-test',
    }));
    vi.doMock('../lib/credentials.js', () => ({
      getCredentials: vi.fn(),
    }));
    const module = await import('./analytics.js');
    Analytics = module.Analytics;
    analytics = new Analytics();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.WORKOS_TELEMETRY = originalEnv;
    } else {
      delete process.env.WORKOS_TELEMETRY;
    }
  });

  function assertCleanQueue() {
    const serialized = JSON.stringify(mockQueueEvent.mock.calls);
    expect(serialized).not.toContain(home);
    expect(serialized).not.toContain(POISON_BEARER);
    expect(serialized).not.toContain(POISON_SK);
    expect(serialized).not.toContain(POISON_JWT);
  }

  it('stepCompleted: poisoned error.message does not leak markers', () => {
    const err = new Error(POISON_MESSAGE);
    analytics.stepCompleted('test-step', 100, false, err);
    expect(mockQueueEvent).toHaveBeenCalled();
    assertCleanQueue();
  });

  it('commandExecuted: poisoned error.message does not leak markers', () => {
    const err = new Error(POISON_MESSAGE);
    analytics.commandExecuted('test-command', 100, false, { error: err });
    expect(mockQueueEvent).toHaveBeenCalled();
    assertCleanQueue();
  });

  it('captureUnhandledCrash: poisoned error.message does not leak markers', () => {
    const err = new Error(POISON_MESSAGE);
    analytics.captureUnhandledCrash(err);
    expect(mockQueueEvent).toHaveBeenCalled();
    assertCleanQueue();
  });

  it('captureException: poisoned error.message does not leak via session.end tags', async () => {
    const err = new Error(POISON_MESSAGE);
    analytics.captureException(err);
    // captureException stores into tags; tags flow into session.end at shutdown.
    await analytics.shutdown('error');
    expect(mockQueueEvent).toHaveBeenCalled();
    assertCleanQueue();
  });

  it('replaceLastCommandEvent: inherits sanitization via commandExecuted', () => {
    const err = new Error(POISON_MESSAGE);
    // First queue a provisional event (would normally happen in middleware).
    analytics.commandExecuted('test-command', 0, true);
    mockQueueEvent.mockClear();
    // Then replace it with the real one carrying the poisoned error.
    analytics.replaceLastCommandEvent('test-command', 100, false, { error: err });
    expect(mockReplaceLastEventOfType).toHaveBeenCalledWith('command');
    expect(mockQueueEvent).toHaveBeenCalled();
    assertCleanQueue();
  });
});
