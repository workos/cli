import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * Locks the Layer-1 invariant of the agent/CI path fix: when prompts are not
 * allowed (agent/ci/non-TTY), abortIfCancelled must fail fast with a structured
 * CliExit *without awaiting* the input promise — awaiting a never-resolving
 * prompt is exactly the hang this guard fixes.
 */

vi.mock('./ui.js', () => ({
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

const ui = (await import('./ui.js')).default;
const { setInteractionMode, resetInteractionModeForTests } = await import('./interaction-mode.js');
const { CliExit } = await import('./cli-exit.js');
const { setOutputMode } = await import('./output.js');
const { analytics } = await import('./analytics.js');
const { abortIfCancelled, getOrAskForWorkOSCredentials } = await import('./ui-utils.js');

describe('abortIfCancelled — non-interactive guard', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
    setOutputMode('human');
    vi.clearAllMocks();
    vi.mocked(ui.isCancel).mockReturnValue(false);
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
    vi.mocked(ui.isCancel).mockReturnValue(false);
    await expect(abortIfCancelled('value')).resolves.toBe('value');
  });

  it('does not flush a cancelled session on the happy path (no per-prompt dead-time)', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    vi.mocked(ui.isCancel).mockReturnValue(false);

    await abortIfCancelled('value');

    // shutdown('cancelled') must fire ONLY on an actual cancel — never on a
    // resolved prompt (regression guard for the 3s-per-prompt flush bug).
    expect(analytics.shutdown).not.toHaveBeenCalled();
  });
});

describe('getOrAskForWorkOSCredentials — credential-source-aware copy', () => {
  const base = { apiKey: 'sk_test', clientId: 'client_x', installDir: '/tmp' } as const;

  beforeEach(() => {
    setOutputMode('human');
    vi.clearAllMocks();
  });

  afterEach(() => {
    setOutputMode('human');
  });

  it('announces "you provided" for cli/manual/undefined sources', async () => {
    for (const credentialSource of ['cli', 'manual', undefined] as const) {
      vi.clearAllMocks();
      const result = await getOrAskForWorkOSCredentials({ ...base, credentialSource });
      expect(result).toEqual({ apiKey: 'sk_test', clientId: 'client_x' });
      expect(ui.log.info).toHaveBeenCalledTimes(1);
      expect(ui.log.info).toHaveBeenCalledWith('Using the WorkOS credentials you provided');
    }
  });

  it('stays silent for device/stored/env sources (machine already announced)', async () => {
    for (const credentialSource of ['device', 'stored', 'env'] as const) {
      vi.clearAllMocks();
      await getOrAskForWorkOSCredentials({ ...base, credentialSource });
      expect(ui.log.info).not.toHaveBeenCalled();
    }
  });

  it('stays silent in dashboard mode', async () => {
    await getOrAskForWorkOSCredentials({ ...base, dashboard: true, credentialSource: 'cli' });
    expect(ui.log.info).not.toHaveBeenCalled();
  });

  it('stays silent in JSON output mode (no human copy into JSON)', async () => {
    setOutputMode('json');
    await getOrAskForWorkOSCredentials({ ...base, credentialSource: 'cli' });
    expect(ui.log.info).not.toHaveBeenCalled();
  });
});
