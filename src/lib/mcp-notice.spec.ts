import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpClientResult } from './mcp-clients.js';

// --- Controllable module state (read lazily inside mock factories) ---
let prefs: Record<string, unknown> = {};
let promptAllowed = true;
let humanMode = true;
let jsonMode = false;
let detectResult: unknown[] = [];

const loadPreferencesMock = vi.fn(() => Promise.resolve(prefs));
const savePreferencesMock = vi.fn();
vi.mock('./preferences.js', () => ({
  loadPreferences: (...a: unknown[]) => loadPreferencesMock(...(a as [])),
  savePreferences: (...a: unknown[]) => savePreferencesMock(...(a as [])),
}));

vi.mock('../utils/interaction-mode.js', () => ({
  isPromptAllowed: () => promptAllowed,
  isHumanMode: () => humanMode,
}));

vi.mock('../utils/output.js', () => ({ isJsonMode: () => jsonMode }));

const mockRenderStderrBox = vi.fn();
vi.mock('../utils/box.js', () => ({
  renderStderrBox: (...a: unknown[]) => mockRenderStderrBox(...(a as [])),
}));

const detectMcpClientsMock = vi.fn(() => Promise.resolve(detectResult));
vi.mock('./mcp-clients.js', () => ({
  detectMcpClients: (...a: unknown[]) => detectMcpClientsMock(...(a as [])),
}));

const confirmMock = vi.fn();
const isCancelMock = vi.fn(() => false);
const clackLog = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../utils/clack.js', () => ({
  default: {
    confirm: (...a: unknown[]) => confirmMock(...(a as [])),
    isCancel: (...a: unknown[]) => isCancelMock(...(a as [])),
    log: clackLog,
  },
}));

const captureMock = vi.fn();
const emitCommandEventMock = vi.fn();
vi.mock('../utils/analytics.js', () => ({
  analytics: {
    capture: (...a: unknown[]) => captureMock(...(a as [])),
    emitCommandEvent: (...a: unknown[]) => emitCommandEventMock(...(a as [])),
  },
}));

const {
  getMcpAskState,
  recordMcpDeclined,
  recordMcpBannerShown,
  isAutoAskEligible,
  maybeShowMcpNotice,
  maybeOfferMcpInstall,
  resetMcpNoticeState,
  MCP_OFFER_TIMEOUT_MS,
} = await import('./mcp-notice.js');
const { markStartupNoticeShown, resetStartupNoticeGate } = await import('./startup-notice-gate.js');

interface FakeClientOpts {
  installed?: boolean;
  add?: McpClientResult;
  addThrows?: boolean;
}
function fakeClient(key: string, displayName: string, opts: FakeClientOpts = {}) {
  return {
    key,
    displayName,
    isAvailable: vi.fn(() => Promise.resolve(true)),
    isInstalled: vi.fn(() => Promise.resolve(opts.installed ?? false)),
    add: vi.fn(() =>
      opts.addThrows
        ? Promise.reject(new Error('add exploded'))
        : Promise.resolve(opts.add ?? ({ agent: key, displayName, outcome: 'installed' } as McpClientResult)),
    ),
    remove: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prefs = {};
  promptAllowed = true;
  humanMode = true;
  jsonMode = false;
  detectResult = [];
  loadPreferencesMock.mockImplementation(() => Promise.resolve(prefs));
  detectMcpClientsMock.mockImplementation(() => Promise.resolve(detectResult));
  savePreferencesMock.mockReset();
  confirmMock.mockReset();
  isCancelMock.mockReturnValue(false);
  resetMcpNoticeState();
  resetStartupNoticeGate();
});

describe('getMcpAskState', () => {
  it('reads declined + bannerShown from prefs', async () => {
    prefs = { mcp: { promptDeclined: true, bannerShownAt: '2026-01-01T00:00:00.000Z' } };
    expect(await getMcpAskState()).toEqual({ declined: true, bannerShown: true });
  });

  it('defaults to false when no mcp prefs exist', async () => {
    prefs = {};
    expect(await getMcpAskState()).toEqual({ declined: false, bannerShown: false });
  });

  it('degrades to false/false when loadPreferences throws', async () => {
    loadPreferencesMock.mockRejectedValueOnce(new Error('EIO'));
    expect(await getMcpAskState()).toEqual({ declined: false, bannerShown: false });
  });
});

describe('markers', () => {
  it('recordMcpDeclined persists promptDeclined', async () => {
    await recordMcpDeclined();
    expect(savePreferencesMock).toHaveBeenCalledWith({ mcp: { promptDeclined: true } });
  });

  it('recordMcpBannerShown persists a bannerShownAt timestamp', async () => {
    await recordMcpBannerShown();
    expect(savePreferencesMock).toHaveBeenCalledWith({ mcp: { bannerShownAt: expect.any(String) } });
  });

  it('swallows prefs write failures (degrades to per-run memory)', async () => {
    savePreferencesMock.mockImplementation(() => {
      throw new Error('EROFS');
    });
    await expect(recordMcpDeclined()).resolves.toBeUndefined();
    await expect(recordMcpBannerShown()).resolves.toBeUndefined();
  });
});

describe('isAutoAskEligible', () => {
  it('false when declined — and never shells out to detect clients', async () => {
    prefs = { mcp: { promptDeclined: true } };
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    expect(await isAutoAskEligible()).toBe(false);
    expect(detectMcpClientsMock).not.toHaveBeenCalled();
  });

  it('false when no agents are detected', async () => {
    detectResult = [];
    expect(await isAutoAskEligible()).toBe(false);
  });

  it('false when every detected agent already has the server', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: true })];
    expect(await isAutoAskEligible()).toBe(false);
  });

  it('true when at least one detected agent lacks the server', async () => {
    detectResult = [
      fakeClient('claude-code', 'Claude Code', { installed: true }),
      fakeClient('cursor', 'Cursor', { installed: false }),
    ];
    expect(await isAutoAskEligible()).toBe(true);
  });
});

describe('maybeShowMcpNotice (banner)', () => {
  it('renders once and records bannerShown when eligible in human mode', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);
    expect(savePreferencesMock).toHaveBeenCalledWith({ mcp: { bannerShownAt: expect.any(String) } });
  });

  it('emits a banner impression event when shown', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(emitCommandEventMock).toHaveBeenCalledTimes(1);
    expect(emitCommandEventMock).toHaveBeenCalledWith('mcp offer', 0, true, {
      extraAttributes: { 'mcp.entry_point': 'banner', 'mcp.shown': true },
    });
  });

  it('does not render or emit a second time in the same session', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).toHaveBeenCalledTimes(1);
    expect(emitCommandEventMock).toHaveBeenCalledTimes(1);
  });

  it('suppressed outside human mode', async () => {
    humanMode = false;
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('suppressed in JSON mode', async () => {
    jsonMode = true;
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('defers when another startup notice already fired this run', async () => {
    markStartupNoticeShown(); // e.g. the telemetry notice or unclaimed warning won
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('suppressed when the banner was already shown on a previous run', async () => {
    prefs = { mcp: { bannerShownAt: '2025-01-01T00:00:00.000Z' } };
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('suppressed for a declined user', async () => {
    prefs = { mcp: { promptDeclined: true } };
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });

  it('suppressed when nothing is installable (all agents already have it)', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: true })];
    await maybeShowMcpNotice();
    expect(mockRenderStderrBox).not.toHaveBeenCalled();
  });
});

describe('maybeOfferMcpInstall (install-flow prompt)', () => {
  it('never prompts when prompting is not allowed (agent/CI/non-TTY)', async () => {
    promptAllowed = false;
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(emitCommandEventMock).not.toHaveBeenCalled();
    expect(savePreferencesMock).not.toHaveBeenCalled();
  });

  it('never prompts in JSON mode (e.g. `install --json` on a TTY) so output stays clean', async () => {
    jsonMode = true; // human interaction mode but machine-readable output
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });
    expect(confirmMock).not.toHaveBeenCalled();
    expect(emitCommandEventMock).not.toHaveBeenCalled();
  });

  it('installs to detected-and-missing agents on accept and captures the outcome', async () => {
    const claude = fakeClient('claude-code', 'Claude Code', { installed: false });
    const cursor = fakeClient('cursor', 'Cursor', { installed: true }); // already has it → not a target
    detectResult = [claude, cursor];
    confirmMock.mockResolvedValue(true);

    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });

    // Prompt names only the installable agent.
    const message = confirmMock.mock.calls[0][0].message as string;
    expect(message).toContain('Claude Code');
    expect(message).not.toContain('Cursor');

    expect(claude.add).toHaveBeenCalledTimes(1);
    expect(cursor.add).not.toHaveBeenCalled();
    expect(emitCommandEventMock).toHaveBeenCalledWith('mcp offer', expect.any(Number), true, {
      extraAttributes: {
        'mcp.entry_point': 'install-flow',
        'mcp.accepted': true,
        'mcp.agents_installed': 'claude-code',
        'mcp.agents_failed': '',
      },
    });
  });

  it('records the decline and captures accepted:false on explicit no', async () => {
    const cursor = fakeClient('cursor', 'Cursor', { installed: false });
    detectResult = [cursor];
    confirmMock.mockResolvedValue(false);

    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });

    expect(savePreferencesMock).toHaveBeenCalledWith({ mcp: { promptDeclined: true } });
    expect(cursor.add).not.toHaveBeenCalled();
    // A decline is a completed interaction, not an error: success stays true.
    expect(emitCommandEventMock).toHaveBeenCalledWith('mcp offer', expect.any(Number), true, {
      extraAttributes: {
        'mcp.entry_point': 'install-flow',
        'mcp.accepted': false,
        'mcp.agents_installed': '',
        'mcp.agents_failed': '',
      },
    });
  });

  it('treats ctrl-C (cancel) as neither a decline nor an install', async () => {
    const cursor = fakeClient('cursor', 'Cursor', { installed: false });
    detectResult = [cursor];
    confirmMock.mockResolvedValue(Symbol('cancel'));
    isCancelMock.mockReturnValue(true);

    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });

    expect(savePreferencesMock).not.toHaveBeenCalled();
    expect(emitCommandEventMock).not.toHaveBeenCalled();
    expect(cursor.add).not.toHaveBeenCalled();
  });

  it('does not prompt a user who already declined', async () => {
    prefs = { mcp: { promptDeclined: true } };
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false })];
    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('does not prompt when there is nothing to install', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: true })];
    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });
    expect(confirmMock).not.toHaveBeenCalled();
  });

  it('never throws even if a client install throws (install flow unaffected)', async () => {
    detectResult = [fakeClient('cursor', 'Cursor', { installed: false, addThrows: true })];
    confirmMock.mockResolvedValue(true);
    await expect(maybeOfferMcpInstall({ entryPoint: 'install-flow' })).resolves.toBeUndefined();
  });

  it('reports both installed and failed agents in the capture', async () => {
    const ok = fakeClient('claude-code', 'Claude Code', {
      installed: false,
      add: { agent: 'claude-code', displayName: 'Claude Code', outcome: 'installed' },
    });
    const bad = fakeClient('cursor', 'Cursor', {
      installed: false,
      add: { agent: 'cursor', displayName: 'Cursor', outcome: 'failed', error: 'nope' },
    });
    detectResult = [ok, bad];
    confirmMock.mockResolvedValue(true);

    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });

    // An accepted offer with a failed agent install is an error span:
    // success flips to false while the per-agent lists carry the detail.
    expect(emitCommandEventMock).toHaveBeenCalledWith('mcp offer', expect.any(Number), false, {
      extraAttributes: {
        'mcp.entry_point': 'install-flow',
        'mcp.accepted': true,
        'mcp.agents_installed': 'claude-code',
        'mcp.agents_failed': 'cursor',
      },
    });
  });

  it('aborts a hung prompt at the deadline: stdin released, nothing recorded', async () => {
    const CANCEL = Symbol('clack:cancel');
    const cursor = fakeClient('cursor', 'Cursor', { installed: false });
    detectResult = [cursor];
    // A prompt that never gets an answer: it only resolves (as a cancel, the
    // way clack does) when the deadline signal aborts it.
    confirmMock.mockImplementation(
      (opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(CANCEL), { once: true });
        }),
    );
    isCancelMock.mockImplementation((v: unknown) => v === CANCEL);

    vi.useFakeTimers();
    try {
      const offer = maybeOfferMcpInstall({ entryPoint: 'install-flow' });
      await vi.advanceTimersByTimeAsync(MCP_OFFER_TIMEOUT_MS);
      await expect(offer).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    // The prompt must receive the deadline signal — without it, the race
    // resolves but the pending confirm keeps stdin (and the process) alive.
    expect(confirmMock.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
    // A timeout is a cancel, not a decline: nothing persisted, nothing emitted.
    expect(savePreferencesMock).not.toHaveBeenCalled();
    expect(emitCommandEventMock).not.toHaveBeenCalled();
    expect(cursor.add).not.toHaveBeenCalled();
  });

  it('does not start installs when the answer lands at the deadline', async () => {
    const cursor = fakeClient('cursor', 'Cursor', { installed: false });
    detectResult = [cursor];
    // Simulate a "yes" submitted in the same tick the deadline fires (submit
    // beats cancel inside clack): the signal is already aborted by the time
    // the flow sees the answer.
    confirmMock.mockImplementation(
      (opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(true), { once: true });
        }),
    );

    vi.useFakeTimers();
    try {
      const offer = maybeOfferMcpInstall({ entryPoint: 'install-flow' });
      await vi.advanceTimersByTimeAsync(MCP_OFFER_TIMEOUT_MS);
      await expect(offer).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }

    // The outer flow already moved on — no detached install work, no emission.
    expect(cursor.add).not.toHaveBeenCalled();
    expect(emitCommandEventMock).not.toHaveBeenCalled();
  });

  it('counts already-installed agents as installed in the emission', async () => {
    const already = fakeClient('codex', 'Codex', {
      installed: false,
      add: { agent: 'codex', displayName: 'Codex', outcome: 'already-installed' },
    });
    detectResult = [already];
    confirmMock.mockResolvedValue(true);

    await maybeOfferMcpInstall({ entryPoint: 'install-flow' });

    expect(emitCommandEventMock).toHaveBeenCalledWith('mcp offer', expect.any(Number), true, {
      extraAttributes: expect.objectContaining({ 'mcp.agents_installed': 'codex', 'mcp.agents_failed': '' }),
    });
  });
});
