import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Force a provider to be detected so we reach the upload decision point.
// Use a class (not an arrow fn) so `new VercelEnvironmentProvider()` constructs.
vi.mock('./providers/vercel.js', () => ({
  VercelEnvironmentProvider: class {
    name = 'Vercel';
    detect = vi.fn(async () => true);
    uploadEnvVars = vi.fn(async () => ({}));
  },
}));

vi.mock('../../utils/ui.js', () => ({
  default: {
    select: vi.fn(),
    isCancel: vi.fn(() => false),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), step: vi.fn(), message: vi.fn() },
  },
}));

vi.mock('../../utils/analytics.js', () => ({
  analytics: { capture: vi.fn(), shutdown: vi.fn(), setTag: vi.fn() },
}));

const ui = (await import('../../utils/ui.js')).default;
const { uploadEnvironmentVariablesStep } = await import('./index.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../../utils/interaction-mode.js');

const integration = 'nextjs' as never;
const options = { installDir: '/proj' } as never;

describe('uploadEnvironmentVariablesStep — non-interactive skip', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
    vi.clearAllMocks();
    vi.mocked(ui.isCancel).mockReturnValue(false);
  });

  afterEach(() => {
    resetInteractionModeForTests();
  });

  it('ci mode skips the upload prompt and returns []', async () => {
    setInteractionMode({ mode: 'ci', source: 'env' });

    const result = await uploadEnvironmentVariablesStep({}, { integration, options });

    expect(result).toEqual([]);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it('human mode reaches the prompt', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    vi.mocked(ui.select).mockResolvedValueOnce(false as never);

    const result = await uploadEnvironmentVariablesStep({}, { integration, options });

    expect(result).toEqual([]);
    expect(ui.select).toHaveBeenCalledOnce();
  });
});
