import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('fast-glob', () => ({ default: vi.fn(async () => []) }));

vi.mock('../../utils/clack.js', () => ({
  default: {
    select: vi.fn(),
    isCancel: vi.fn(() => false),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn(), message: vi.fn() },
  },
}));

// Passthrough abortIfCancelled + a package.json with no react-router version, so
// getReactRouterMode always hits the ambiguous "no version" prompt branch.
vi.mock('../../utils/clack-utils.js', () => ({
  abortIfCancelled: vi.fn(async (p) => await p),
  getPackageDotJson: vi.fn(async () => ({})),
}));

const clack = (await import('../../utils/clack.js')).default;
const { getReactRouterMode, ReactRouterMode } = await import('./utils.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../../utils/interaction-mode.js');

describe('getReactRouterMode — ambiguous-branch defaults', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
    vi.clearAllMocks();
    vi.mocked(clack.isCancel).mockReturnValue(false);
  });

  afterEach(() => {
    resetInteractionModeForTests();
  });

  it('agent mode with no detectable version defaults to v7 Framework with a warning (no prompt)', async () => {
    setInteractionMode({ mode: 'agent', source: 'env' });

    const result = await getReactRouterMode({ installDir: '/proj' } as never);

    expect(result).toBe(ReactRouterMode.V7_FRAMEWORK);
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.log.warn).toHaveBeenCalled();
  });

  it('ci mode with no detectable version defaults to v7 Framework with a warning (no prompt)', async () => {
    setInteractionMode({ mode: 'ci', source: 'env' });

    const result = await getReactRouterMode({ installDir: '/proj' } as never);

    expect(result).toBe(ReactRouterMode.V7_FRAMEWORK);
    expect(clack.select).not.toHaveBeenCalled();
    expect(clack.log.warn).toHaveBeenCalled();
  });

  it('human mode with no detectable version prompts and uses the answer', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    vi.mocked(clack.select).mockResolvedValueOnce(ReactRouterMode.V6 as never);

    const result = await getReactRouterMode({ installDir: '/proj' } as never);

    expect(result).toBe(ReactRouterMode.V6);
    expect(clack.select).toHaveBeenCalledOnce();
  });
});
