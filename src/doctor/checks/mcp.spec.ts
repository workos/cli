import { describe, it, expect, vi, beforeEach } from 'vitest';

let detectResult: unknown[] = [];
let cursorUrl: string | null = null;

const detectMcpClientsMock = vi.fn(() => Promise.resolve(detectResult));
const getCursorConfiguredUrlMock = vi.fn(() => Promise.resolve(cursorUrl));
vi.mock('../../lib/mcp-clients.js', () => ({
  detectMcpClients: (...a: unknown[]) => detectMcpClientsMock(...(a as [])),
  getCursorConfiguredUrl: (...a: unknown[]) => getCursorConfiguredUrlMock(...(a as [])),
}));

const { MCP_SERVER_URL } = await import('../../lib/constants.js');
const { checkMcp } = await import('./mcp.js');

function fakeClient(key: string, displayName: string, installed: boolean) {
  return {
    key,
    displayName,
    isAvailable: vi.fn(() => Promise.resolve(true)),
    isInstalled: vi.fn(() => Promise.resolve(installed)),
    add: vi.fn(),
    remove: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  detectResult = [];
  cursorUrl = null;
  detectMcpClientsMock.mockImplementation(() => Promise.resolve(detectResult));
  getCursorConfiguredUrlMock.mockImplementation(() => Promise.resolve(cursorUrl));
});

describe('checkMcp', () => {
  it('returns null when no coding agents are detected', async () => {
    detectResult = [];
    expect(await checkMcp()).toBeNull();
  });

  it('reports available + installed per detected agent, with the server URL', async () => {
    detectResult = [fakeClient('claude-code', 'Claude Code', true), fakeClient('codex', 'Codex', false)];

    const result = await checkMcp();

    expect(result).toEqual({
      serverUrl: MCP_SERVER_URL,
      agents: [
        { agent: 'Claude Code', available: true, installed: true },
        { agent: 'Codex', available: true, installed: false },
      ],
    });
  });

  it('flags a Cursor entry with an unexpected URL as misconfigured', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', true)];
    cursorUrl = 'https://evil.example.com/mcp';

    const result = await checkMcp();

    expect(result!.agents[0]).toEqual({ agent: 'Cursor', available: true, installed: true, misconfigured: true });
  });

  it('does not flag Cursor when the configured URL matches', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', true)];
    cursorUrl = MCP_SERVER_URL;

    const result = await checkMcp();

    expect(result!.agents[0].misconfigured).toBe(false);
  });

  it('does not flag Cursor when the URL cannot be read (null)', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', true)];
    cursorUrl = null;

    const result = await checkMcp();

    expect(result!.agents[0].misconfigured).toBe(false);
  });

  it('never reads the URL (nor flags) when Cursor lacks the server', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', false)];

    const result = await checkMcp();

    expect(result!.agents[0].misconfigured).toBeUndefined();
    expect(getCursorConfiguredUrlMock).not.toHaveBeenCalled();
  });

  it('handles the mixed matrix: one installed, one missing, one misconfigured', async () => {
    detectResult = [
      fakeClient('claude-code', 'Claude Code', true),
      fakeClient('codex', 'Codex', false),
      fakeClient('cursor', 'Cursor', true),
    ];
    cursorUrl = 'https://stale.example.com/mcp';

    const result = await checkMcp();

    expect(result!.agents).toEqual([
      { agent: 'Claude Code', available: true, installed: true },
      { agent: 'Codex', available: true, installed: false },
      { agent: 'Cursor', available: true, installed: true, misconfigured: true },
    ]);
  });
});
