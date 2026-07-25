import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);
vi.mock('../utils/ui.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
  },
}));

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');
const { confirmDestructive, requireConfirmationFlag } = await import('./confirm.js');
const { CliExit } = await import('../utils/cli-exit.js');

async function expectExit(promise: Promise<unknown>, code: number): Promise<CliExit> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected promise to reject with CliExit(${code}) but it resolved`);
}

let stderrOutput: string[];
let stdoutOutput: string[];
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  resetInteractionModeForTests();
  setOutputMode('human');
  mockConfirm.mockReset();
  mockIsCancel.mockReset();
  mockIsCancel.mockReturnValue(false);
  stderrOutput = [];
  stdoutOutput = [];
  errorSpy = vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
    stderrOutput.push(String(msg));
  });
  logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
    stdoutOutput.push(String(msg));
  });
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  resetInteractionModeForTests();
  setOutputMode('human');
});

describe('confirmDestructive', () => {
  it('exits 1 with confirmation_required in agent mode without --yes', async () => {
    setInteractionMode({ mode: 'agent', source: 'agent_env' });
    setOutputMode('json');
    const err = await expectExit(confirmDestructive({}, { action: 'delete user usr_1' }), 1);
    expect(err.context?.errorCode).toBe('confirmation_required');
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string } };
        return parsed.error?.code === 'confirmation_required';
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('exits 1 with confirmation_required in CI mode without --yes', async () => {
    setInteractionMode({ mode: 'ci', source: 'ci_env' });
    setOutputMode('json');
    await expectExit(confirmDestructive({}, { action: 'delete user usr_1' }), 1);
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string; message?: string } };
        return parsed.error?.code === 'confirmation_required' && /CI mode/.test(parsed.error?.message ?? '');
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
  });

  it('proceeds in agent mode when --yes is set', async () => {
    setInteractionMode({ mode: 'agent', source: 'agent_env' });
    setOutputMode('json');
    await expect(confirmDestructive({ yes: true }, { action: 'delete user usr_1' })).resolves.toBeUndefined();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('exits 1 with confirmation_required in JSON mode even when interactive', async () => {
    // Human/interactive mode, but JSON output requested: prompting would pollute
    // stdout, so refuse rather than prompt.
    setInteractionMode({ mode: 'human', source: 'default' });
    setOutputMode('json');
    await expectExit(confirmDestructive({}, { action: 'delete user usr_1' }), 1);
    const errorLine = stderrOutput.find((line) => {
      try {
        const parsed = JSON.parse(line) as { error?: { code?: string; message?: string } };
        return parsed.error?.code === 'confirmation_required' && /JSON mode/.test(parsed.error?.message ?? '');
      } catch {
        return false;
      }
    });
    expect(errorLine).toBeDefined();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('exits 2 (CANCELLED) when the interactive prompt is declined', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    setOutputMode('human');
    mockConfirm.mockResolvedValue(false);
    await expectExit(confirmDestructive({}, { action: 'delete user usr_1' }), 2);
    expect(mockConfirm).toHaveBeenCalledOnce();
  });

  it('exits 2 (CANCELLED) when the interactive prompt is cancelled (Ctrl+C)', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    setOutputMode('human');
    const cancelSymbol = Symbol('ui-cancel');
    mockConfirm.mockResolvedValue(cancelSymbol);
    mockIsCancel.mockImplementation((v: unknown) => v === cancelSymbol);
    await expectExit(confirmDestructive({}, { action: 'delete user usr_1' }), 2);
  });

  it('proceeds when the interactive prompt is confirmed', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    setOutputMode('human');
    mockConfirm.mockResolvedValue(true);
    await expect(confirmDestructive({}, { action: 'delete user usr_1' })).resolves.toBeUndefined();
    expect(mockConfirm).toHaveBeenCalledOnce();
  });
});

describe('requireConfirmationFlag', () => {
  it('exits 1 with confirmation_required in agent mode without --yes', async () => {
    setInteractionMode({ mode: 'agent', source: 'agent_env' });
    setOutputMode('json');
    const err = await expectExit(requireConfirmationFlag({}, { action: 'change a role' }), 1);
    expect(err.context?.errorCode).toBe('confirmation_required');
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('exits 1 with confirmation_required in CI mode without --yes', async () => {
    setInteractionMode({ mode: 'ci', source: 'ci_env' });
    setOutputMode('json');
    const err = await expectExit(requireConfirmationFlag({}, { action: 'change a role' }), 1);
    expect(err.context?.errorCode).toBe('confirmation_required');
  });

  it('exits 1 in JSON mode even when interactive (stdout must stay machine-readable)', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    setOutputMode('json');
    await expectExit(requireConfirmationFlag({}, { action: 'change a role' }), 1);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('proceeds non-interactive when --yes is set', async () => {
    setInteractionMode({ mode: 'agent', source: 'agent_env' });
    setOutputMode('json');
    await expect(requireConfirmationFlag({ yes: true }, { action: 'change a role' })).resolves.toBeUndefined();
  });

  it('proceeds interactively without --yes and never prompts (human is trusted)', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    setOutputMode('human');
    await expect(requireConfirmationFlag({}, { action: 'change a role' })).resolves.toBeUndefined();
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});
