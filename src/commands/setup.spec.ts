import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
const CANCEL = Symbol('cancel');

vi.mock('../utils/ui.js', () => ({
  default: {
    heading: vi.fn(),
    note: vi.fn(),
    log: { info: vi.fn(), success: vi.fn(), error: vi.fn(), hint: vi.fn() },
    confirm: vi.fn(),
  },
  isCancel: (v: unknown) => v === CANCEL,
  CANCEL,
}));

vi.mock('../utils/output.js', () => ({
  isJsonMode: vi.fn(() => false),
  outputSuccess: vi.fn(),
  exitWithError: vi.fn((e: { code: string }) => {
    throw new Error(`exit:${e.code}`);
  }),
}));

vi.mock('../utils/exit-codes.js', () => ({
  ExitCode: { GENERAL_ERROR: 1 },
  exitWithCode: vi.fn((c: number) => {
    throw new Error(`exitCode:${c}`);
  }),
}));

vi.mock('../utils/interaction-mode.js', () => ({
  isPromptAllowed: vi.fn(() => true),
}));

vi.mock('../lib/preferences.js', () => ({
  isSetupDeclined: vi.fn(() => false),
  isSetupCompleted: vi.fn(() => false),
  recordSetupDeclined: vi.fn(),
  recordSetupCompleted: vi.fn(),
  clearSetupDecline: vi.fn(),
}));

vi.mock('./install-skill.js', () => ({
  createAgents: vi.fn(() => ({
    'claude-code': { name: 'claude-code', displayName: 'Claude Code' },
    cursor: { name: 'cursor', displayName: 'Cursor' },
  })),
  detectAgents: vi.fn(),
  refreshWorkOSSkills: vi.fn(),
}));

vi.mock('../lib/mcp-clients.js', () => ({
  detectMcpClients: vi.fn(),
  MCP_AGENT_KEYS: ['claude-code', 'codex', 'cursor'],
  MCP_OUTCOME_LABELS: {
    installed: 'installed',
    'already-installed': 'already installed',
    removed: 'removed',
    'not-installed': 'not installed',
    skipped: 'skipped',
    failed: 'failed',
  },
}));

vi.mock('../utils/analytics.js', () => ({
  analytics: { emitCommandEvent: vi.fn() },
}));

vi.mock('../utils/command-invocation.js', () => ({
  formatWorkOSCommand: (a: string) => `workos ${a}`,
}));

const ui = (await import('../utils/ui.js')).default;
const { isJsonMode, outputSuccess } = await import('../utils/output.js');
const { isPromptAllowed } = await import('../utils/interaction-mode.js');
const prefs = await import('../lib/preferences.js');
const { detectAgents, refreshWorkOSSkills } = await import('./install-skill.js');
const { detectMcpClients } = await import('../lib/mcp-clients.js');
const { analytics } = await import('../utils/analytics.js');

const { runSetup, maybeRunSetupAfter, SETUP_OFFER_TIMEOUT_MS } = await import('./setup.js');

// ── Fixtures ──────────────────────────────────────────────────────────────────
const claudeAgent = { name: 'claude-code', displayName: 'Claude Code', globalSkillsDir: '/x', detect: () => true };
function mcpTarget(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    key: 'claude-code',
    displayName: 'Claude Code',
    isAvailable: vi.fn(async () => true),
    isInstalled: vi.fn(async () => false),
    add: vi.fn(async () => ({ agent: 'claude-code', displayName: 'Claude Code', outcome: 'installed' })),
    remove: vi.fn(),
    ...overrides,
  };
}

function detectSome() {
  vi.mocked(detectAgents).mockReturnValue([claudeAgent as any]);
  vi.mocked(detectMcpClients).mockResolvedValue([mcpTarget() as any]);
}
function detectNone() {
  vi.mocked(detectAgents).mockReturnValue([]);
  vi.mocked(detectMcpClients).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isPromptAllowed).mockReturnValue(true);
  vi.mocked(isJsonMode).mockReturnValue(false);
  vi.mocked(prefs.isSetupDeclined).mockReturnValue(false);
  vi.mocked(prefs.isSetupCompleted).mockReturnValue(false);
  vi.mocked(refreshWorkOSSkills).mockResolvedValue({
    agents: [claudeAgent as any],
    skills: ['workos', 'workos-widgets'],
    version: '1.0.0',
    perAgentBefore: {},
    perAgentAfter: {},
  });
});

describe('runSetup — automatic triggers (login/install)', () => {
  it('does nothing when prompting is not allowed (agent/CI/non-TTY)', async () => {
    detectSome();
    vi.mocked(isPromptAllowed).mockReturnValue(false);

    await runSetup({ trigger: 'login' });

    expect(ui.confirm).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    // Bails BEFORE agent detection so a machine login never pays for the
    // MCP client shell-outs (`claude mcp list`, etc.).
    expect(detectMcpClients).not.toHaveBeenCalled();
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it('does nothing in JSON mode', async () => {
    detectSome();
    vi.mocked(isJsonMode).mockReturnValue(true);

    await runSetup({ trigger: 'install' });

    expect(ui.confirm).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
  });

  it('does nothing when already declined (incl. legacy mcp decline)', async () => {
    detectSome();
    vi.mocked(prefs.isSetupDeclined).mockReturnValue(true);

    await runSetup({ trigger: 'login' });

    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it('does nothing when setup already completed', async () => {
    detectSome();
    vi.mocked(prefs.isSetupCompleted).mockReturnValue(true);

    await runSetup({ trigger: 'login' });

    expect(ui.confirm).not.toHaveBeenCalled();
  });

  it('installs skills + MCP and records completion on accept', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(true);
    const target = mcpTarget();
    vi.mocked(detectMcpClients).mockResolvedValue([target as any]);

    await runSetup({ trigger: 'login' });

    expect(refreshWorkOSSkills).toHaveBeenCalledWith({ agents: [claudeAgent] });
    expect(target.add).toHaveBeenCalledOnce();
    expect(prefs.recordSetupCompleted).toHaveBeenCalledOnce();
    expect(prefs.recordSetupDeclined).not.toHaveBeenCalled();
    expect(analytics.emitCommandEvent).toHaveBeenCalledWith(
      'setup offer',
      expect.any(Number),
      true,
      expect.objectContaining({ extraAttributes: expect.objectContaining({ 'setup.accepted': true }) }),
    );
  });

  it('records an absolute decline and installs nothing on "no"', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(false);

    await runSetup({ trigger: 'login' });

    expect(prefs.recordSetupDeclined).toHaveBeenCalledOnce();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    expect(prefs.recordSetupCompleted).not.toHaveBeenCalled();
  });

  it('treats cancel (ctrl-c) as skip — no decline recorded', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(CANCEL);

    await runSetup({ trigger: 'login' });

    expect(prefs.recordSetupDeclined).not.toHaveBeenCalled();
    expect(prefs.recordSetupCompleted).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
  });

  it('stays silent when no supported agents are detected', async () => {
    detectNone();

    await runSetup({ trigger: 'login' });

    expect(ui.confirm).not.toHaveBeenCalled();
    expect(ui.log.info).not.toHaveBeenCalled();
  });
});

describe('runSetup — command trigger', () => {
  it('reset clears the decline and returns without offering', async () => {
    await runSetup({ trigger: 'command', reset: true });

    expect(prefs.clearSetupDecline).toHaveBeenCalledOnce();
    expect(detectAgents).not.toHaveBeenCalled();
  });

  it('reports "no agents" explicitly when invoked directly', async () => {
    detectNone();

    await runSetup({ trigger: 'command' });

    expect(ui.log.info).toHaveBeenCalledWith(expect.stringContaining('No supported coding agents'));
  });

  it('ignores a prior decline/completion (always runs)', async () => {
    detectSome();
    vi.mocked(prefs.isSetupDeclined).mockReturnValue(true);
    vi.mocked(prefs.isSetupCompleted).mockReturnValue(true);
    vi.mocked(ui.confirm).mockResolvedValue(true);

    await runSetup({ trigger: 'command' });

    expect(refreshWorkOSSkills).toHaveBeenCalledOnce();
  });

  it('errors with confirmation_required in non-interactive mode without --yes', async () => {
    detectSome();
    vi.mocked(isPromptAllowed).mockReturnValue(false);

    await expect(runSetup({ trigger: 'command' })).rejects.toThrow('exit:confirmation_required');
  });

  it('installs without prompting when --yes is passed', async () => {
    detectSome();

    await runSetup({ trigger: 'command', assumeYes: true });

    expect(ui.confirm).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).toHaveBeenCalledOnce();
    expect(prefs.recordSetupCompleted).toHaveBeenCalledOnce();
  });

  it('a "no" on a manual run does NOT record a permanent decline', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(false);

    await runSetup({ trigger: 'command' });

    expect(prefs.recordSetupDeclined).not.toHaveBeenCalled();
  });

  it('skillsOnly skips MCP detection/install', async () => {
    vi.mocked(detectAgents).mockReturnValue([claudeAgent as any]);
    vi.mocked(ui.confirm).mockResolvedValue(true);

    await runSetup({ trigger: 'command', skillsOnly: true });

    expect(detectMcpClients).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).toHaveBeenCalledOnce();
  });

  it('mcpOnly skips skill install', async () => {
    const target = mcpTarget();
    vi.mocked(detectMcpClients).mockResolvedValue([target as any]);
    vi.mocked(ui.confirm).mockResolvedValue(true);

    await runSetup({ trigger: 'command', mcpOnly: true });

    expect(detectAgents).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    expect(target.add).toHaveBeenCalledOnce();
  });

  it('rejects unknown --agents values', async () => {
    await expect(runSetup({ trigger: 'command', agents: ['bogus'] })).rejects.toThrow('exit:unknown_agent');
  });

  it('emits a JSON summary in JSON mode with --yes', async () => {
    detectSome();
    vi.mocked(isJsonMode).mockReturnValue(true);

    await runSetup({ trigger: 'command', assumeYes: true });

    expect(outputSuccess).toHaveBeenCalledWith(
      'Setup complete',
      expect.objectContaining({ skills: expect.anything() }),
    );
  });
});

describe('maybeRunSetupAfter', () => {
  it('never throws even if the offer rejects', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockRejectedValue(new Error('boom'));

    await expect(maybeRunSetupAfter('login')).resolves.toBeUndefined();
  });

  it('aborts a hung prompt after the deadline and resolves (never wedges login/install)', async () => {
    vi.useFakeTimers();
    try {
      detectSome();
      let captured: AbortSignal | undefined;
      // A hung prompt settles to CANCEL only when its signal aborts — exactly
      // what the real facade does when @inquirer throws on abort. (There is no
      // Promise.race fallback anymore, so the mock must honor the signal.)
      vi.mocked(ui.confirm).mockImplementation((opts: any) => {
        captured = opts.signal;
        return new Promise((resolve) => {
          opts.signal?.addEventListener('abort', () => resolve(CANCEL));
        });
      });

      const pending = maybeRunSetupAfter('login');
      await vi.advanceTimersByTimeAsync(SETUP_OFFER_TIMEOUT_MS + 10);

      await expect(pending).resolves.toBeUndefined();
      expect(captured?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
