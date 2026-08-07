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
    installed: 'configured',
    'already-installed': 'already configured',
    removed: 'removed',
    'not-installed': 'not configured',
    skipped: 'skipped',
    failed: 'failed',
  },
}));

vi.mock('../utils/analytics.js', () => ({
  analytics: { emitCommandEvent: vi.fn(), captureException: vi.fn() },
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

const { runSetup, maybeRunSetupAfter } = await import('./setup.js');

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

  it('does NOT record completion when every install fails (transient failure gets re-offered)', async () => {
    // No skill agents to fall back on, and the only MCP target fails to add.
    vi.mocked(detectAgents).mockReturnValue([]);
    const target = mcpTarget({
      add: vi.fn(async () => ({
        agent: 'claude-code',
        displayName: 'Claude Code',
        outcome: 'failed',
        error: 'timeout',
      })),
    });
    vi.mocked(detectMcpClients).mockResolvedValue([target as any]);
    vi.mocked(ui.confirm).mockResolvedValue(true);

    // reportResults still exits non-zero on a failed MCP add.
    await expect(runSetup({ trigger: 'login' })).rejects.toThrow('exitCode:1');

    // Completion must stay unset so the next login/install re-offers.
    expect(prefs.recordSetupCompleted).not.toHaveBeenCalled();
  });

  it('defaults the consent prompt to No (AUTH-6734: install is explicit opt-in)', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(false);

    await runSetup({ trigger: 'login' });

    expect(ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ initialValue: false }));
  });

  it('records an absolute decline and installs nothing on "no"', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(false);

    await runSetup({ trigger: 'login' });

    expect(prefs.recordSetupDeclined).toHaveBeenCalledOnce();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    expect(prefs.recordSetupCompleted).not.toHaveBeenCalled();
  });

  it('prints manual-install instructions when the user declines', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(false);

    await runSetup({ trigger: 'login' });

    const hints = vi.mocked(ui.log.hint).mock.calls.map(([msg]) => String(msg));
    expect(hints.some((m) => m.includes('Nothing was installed'))).toBe(true);
    expect(hints.some((m) => m.includes('workos setup'))).toBe(true);
    expect(hints.some((m) => m.includes('workos skills install'))).toBe(true);
    expect(hints.some((m) => m.includes('workos mcp install'))).toBe(true);
  });

  it('treats cancel (ctrl-c) as skip — no decline recorded, but emits a cancelled event', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(CANCEL);

    await runSetup({ trigger: 'login' });

    expect(prefs.recordSetupDeclined).not.toHaveBeenCalled();
    expect(prefs.recordSetupCompleted).not.toHaveBeenCalled();
    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    // The cut-off must be observable in telemetry (previously it was silent).
    expect(analytics.emitCommandEvent).toHaveBeenCalledWith(
      'setup offer',
      expect.any(Number),
      expect.any(Boolean),
      expect.objectContaining({ extraAttributes: expect.objectContaining({ 'setup.outcome': 'cancelled' }) }),
    );
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

  it('errors (never prompts) for --json on a TTY without --yes', async () => {
    detectSome();
    // JSON output mode, but interaction mode stays human — the exact combo the
    // old guard missed. A prompt here would corrupt machine-readable stdout.
    vi.mocked(isJsonMode).mockReturnValue(true);
    vi.mocked(isPromptAllowed).mockReturnValue(true);

    await expect(runSetup({ trigger: 'command' })).rejects.toThrow('exit:confirmation_required');
    expect(ui.confirm).not.toHaveBeenCalled();
    expect(ui.heading).not.toHaveBeenCalled();
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

  it('scopes the decline instructions to what was offered', async () => {
    vi.mocked(detectAgents).mockReturnValue([claudeAgent as any]);
    vi.mocked(ui.confirm).mockResolvedValue(false);

    await runSetup({ trigger: 'command', skillsOnly: true });

    const hints = vi.mocked(ui.log.hint).mock.calls.map(([msg]) => String(msg));
    expect(hints.some((m) => m.includes('workos skills install'))).toBe(true);
    expect(hints.some((m) => m.includes('workos mcp install'))).toBe(false);
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

  it('reports structured Codex OAuth recovery after configuration', async () => {
    const target = mcpTarget({
      key: 'codex',
      displayName: 'Codex',
      add: vi.fn(async () => ({
        agent: 'codex',
        displayName: 'Codex',
        outcome: 'installed',
        configuration: { scope: 'user', authentication: 'action-required' },
        recovery: {
          docsUrl: 'https://workos.com/docs/mcp',
          hints: [
            {
              description: 'Complete or refresh WorkOS OAuth in your normal host shell',
              command: 'codex mcp login workos',
              hostShellRequired: true,
            },
          ],
        },
      })),
    });
    vi.mocked(detectMcpClients).mockResolvedValue([target as any]);

    await runSetup({ trigger: 'command', mcpOnly: true, assumeYes: true });

    expect(ui.log.success).toHaveBeenCalledWith('MCP server: Codex — configured (user scope)');
    expect(ui.log.hint).toHaveBeenCalledWith(expect.stringContaining('codex mcp login workos'));
    expect(ui.log.hint).toHaveBeenCalledWith(expect.stringContaining('https://workos.com/docs/mcp'));
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
  it('never throws even if the offer rejects, and reports the failure to telemetry', async () => {
    detectSome();
    const boom = new Error('boom');
    vi.mocked(ui.confirm).mockRejectedValue(boom);

    await expect(maybeRunSetupAfter('login')).resolves.toBeUndefined();

    // The swallowed failure must still reach telemetry (previously dropped).
    expect(analytics.captureException).toHaveBeenCalledWith(boom, { 'setup.trigger': 'login' });
  });

  it('does not pass an abort signal to the confirm (the prompt is not time-bounded)', async () => {
    detectSome();
    vi.mocked(ui.confirm).mockResolvedValue(true);

    await maybeRunSetupAfter('login');

    const confirmArgs = vi.mocked(ui.confirm).mock.calls[0][0] as { signal?: AbortSignal };
    expect(confirmArgs.signal).toBeUndefined();
  });
});
