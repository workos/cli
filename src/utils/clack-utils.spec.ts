import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Locks the Layer-1 invariant of the agent/CI path fix: when prompts are not
 * allowed (agent/ci/non-TTY), abortIfCancelled must fail fast with a structured
 * CliExit *without awaiting* the input promise — awaiting a never-resolving
 * prompt is exactly the hang this guard fixes.
 */

vi.mock('./clack.js', () => ({
  default: {
    isCancel: vi.fn(() => false),
    cancel: vi.fn(),
    intro: vi.fn(),
    outro: vi.fn(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      step: vi.fn(),
      message: vi.fn(),
    },
  },
}));

vi.mock('./analytics.js', () => ({
  analytics: { shutdown: vi.fn(), setTag: vi.fn(), capture: vi.fn() },
}));

const clack = (await import('./clack.js')).default;
const { setInteractionMode, resetInteractionModeForTests } = await import('./interaction-mode.js');
const { CliExit } = await import('./cli-exit.js');
const { setOutputMode } = await import('./output.js');
const { abortIfCancelled } = await import('./clack-utils.js');

describe('abortIfCancelled — non-interactive guard', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
    setOutputMode('human');
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  afterEach(() => {
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  it('agent mode throws CliExit without awaiting the input promise', async () => {
    setInteractionMode({ mode: 'agent', source: 'env' });
    // A never-resolving input: if the guard awaited it, this test would time out.
    await expect(abortIfCancelled(new Promise<never>(() => {}))).rejects.toThrow(CliExit);
  });

  it('ci mode throws CliExit without awaiting the input promise', async () => {
    setInteractionMode({ mode: 'ci', source: 'env' });
    await expect(abortIfCancelled(new Promise<never>(() => {}))).rejects.toThrow(CliExit);
  });

  it('emits a structured non_interactive_prompt error in JSON mode', async () => {
    setInteractionMode({ mode: 'agent', source: 'env' });
    setOutputMode('json');
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(abortIfCancelled(new Promise<never>(() => {}))).rejects.toThrow(CliExit);

    expect(errorSpy).toHaveBeenCalled();
    const payload = JSON.parse(String(errorSpy.mock.calls[0][0]));
    expect(payload.error.code).toBe('non_interactive_prompt');

    errorSpy.mockRestore();
  });

  it('human mode passes a resolved value through', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    vi.mocked(clack.isCancel).mockReturnValue(false);
    await expect(abortIfCancelled('value')).resolves.toBe('value');
  });
});
