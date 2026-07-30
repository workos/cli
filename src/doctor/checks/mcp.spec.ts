import { describe, it, expect, vi, beforeEach } from 'vitest';

let detectResult: unknown[] = [];

const detectMcpClientsMock = vi.fn(() => Promise.resolve(detectResult));
vi.mock('../../lib/mcp-clients.js', () => ({
  detectMcpClients: (...a: unknown[]) => detectMcpClientsMock(...(a as [])),
}));

const { MCP_DOCS_URL, MCP_SERVER_URL } = await import('../../lib/constants.js');
const { checkMcp } = await import('./mcp.js');

function fakeClient(key: string, displayName: string, configured: boolean, configuredUrl: string | null = null) {
  return {
    key,
    displayName,
    isAvailable: vi.fn(() => Promise.resolve(true)),
    isInstalled: vi.fn(() => Promise.resolve(configured)),
    getConfiguredUrl: vi.fn(() => Promise.resolve(configuredUrl)),
    add: vi.fn(),
    remove: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  detectResult = [];
  detectMcpClientsMock.mockImplementation(() => Promise.resolve(detectResult));
});

describe('checkMcp', () => {
  it('returns null when no coding agents are detected', async () => {
    detectResult = [];
    expect(await checkMcp()).toBeNull();
  });

  it('reports available + configured per detected agent, with the server and docs URLs', async () => {
    detectResult = [fakeClient('claude-code', 'Claude Code', true), fakeClient('codex', 'Codex', false)];

    const result = await checkMcp();

    expect(result).toEqual({
      serverUrl: MCP_SERVER_URL,
      docsUrl: MCP_DOCS_URL,
      agents: [
        { agent: 'Claude Code', available: true, configured: true, installed: true, misconfigured: false },
        { agent: 'Codex', available: true, configured: false, installed: false },
      ],
    });
  });

  it('flags a Cursor entry with an unexpected URL as misconfigured', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', true, 'https://evil.example.com/mcp')];

    const result = await checkMcp();

    expect(result!.agents[0]).toEqual({
      agent: 'Cursor',
      available: true,
      configured: true,
      installed: true,
      misconfigured: true,
    });
  });

  it('does not flag Cursor when the configured URL matches', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', true, MCP_SERVER_URL)];

    const result = await checkMcp();

    expect(result!.agents[0].misconfigured).toBe(false);
  });

  it('does not flag Cursor when the URL cannot be read (null)', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', true)];

    const result = await checkMcp();

    expect(result!.agents[0].misconfigured).toBe(false);
  });

  it('never reads the URL (nor flags) when Cursor lacks the server', async () => {
    const cursor = fakeClient('cursor', 'Cursor', false);
    detectResult = [cursor];

    const result = await checkMcp();

    expect(result!.agents[0].misconfigured).toBeUndefined();
    expect(cursor.getConfiguredUrl).not.toHaveBeenCalled();
  });

  it('validates the Codex URL and marks OAuth as not verified', async () => {
    detectResult = [fakeClient('codex', 'Codex', true, 'https://wrong.example.com/mcp')];

    const result = await checkMcp();

    expect(result!.agents[0]).toEqual({
      agent: 'Codex',
      available: true,
      configured: true,
      installed: true,
      misconfigured: true,
      authentication: 'not-verified',
    });
  });

  it('handles the mixed matrix: one configured, one missing, one misconfigured', async () => {
    detectResult = [
      fakeClient('claude-code', 'Claude Code', true),
      fakeClient('codex', 'Codex', false),
      fakeClient('cursor', 'Cursor', true, 'https://stale.example.com/mcp'),
    ];

    const result = await checkMcp();

    expect(result!.agents).toEqual([
      { agent: 'Claude Code', available: true, configured: true, installed: true, misconfigured: false },
      { agent: 'Codex', available: true, configured: false, installed: false },
      { agent: 'Cursor', available: true, configured: true, installed: true, misconfigured: true },
    ]);
  });
});
