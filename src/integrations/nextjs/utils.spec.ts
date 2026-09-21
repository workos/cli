import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { InteractionMode } from '../../utils/interaction-mode.js';

vi.mock('fast-glob', () => ({ default: vi.fn() }));

vi.mock('../../utils/ui.js', () => ({
  default: {
    select: vi.fn(),
    isCancel: vi.fn(() => false),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      step: vi.fn(),
      message: vi.fn(),
      detail: vi.fn(),
    },
  },
}));

const fg = (await import('fast-glob')).default;
const ui = (await import('../../utils/ui.js')).default;
const { getNextJsRouter, NextJsRouter, assertSupportedNextJsRouter } = await import('./utils.js');
const { setInteractionMode, resetInteractionModeForTests } = await import('../../utils/interaction-mode.js');

/** Configure fast-glob to report presence of pages/ and/or app/ dirs. */
function mockDetection({ pages, app }: { pages: boolean; app: boolean }): void {
  vi.mocked(fg).mockImplementation((async (pattern: string) => {
    if (String(pattern).includes('pages')) return pages ? ['pages/_app.tsx'] : [];
    return app ? ['app/layout.tsx'] : [];
  }) as never);
}

const modes: InteractionMode[] = ['human', 'agent', 'ci'];

describe('getNextJsRouter', () => {
  beforeEach(() => {
    resetInteractionModeForTests();
    vi.clearAllMocks();
    vi.mocked(ui.isCancel).mockReturnValue(false);
  });

  afterEach(() => {
    resetInteractionModeForTests();
  });

  it.each(modes)('pages-only detection returns pages router without prompting (%s mode)', async (mode) => {
    setInteractionMode({ mode, source: mode === 'human' ? 'default' : 'env' });
    mockDetection({ pages: true, app: false });

    const result = await getNextJsRouter({ installDir: '/proj' });

    expect(result).toBe(NextJsRouter.PAGES_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it.each(modes)('app-only detection returns app router without prompting (%s mode)', async (mode) => {
    setInteractionMode({ mode, source: mode === 'human' ? 'default' : 'env' });
    mockDetection({ pages: false, app: true });

    const result = await getNextJsRouter({ installDir: '/proj' });

    expect(result).toBe(NextJsRouter.APP_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it('mixed-router detection uses App Router without offering unsupported Pages Router', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    mockDetection({ pages: true, app: true });

    const result = await getNextJsRouter({ installDir: '/proj' });

    expect(result).toBe(NextJsRouter.APP_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it('ambiguous detection in agent mode defaults to app router with a warning (no prompt)', async () => {
    setInteractionMode({ mode: 'agent', source: 'env' });
    mockDetection({ pages: true, app: true });

    const result = await getNextJsRouter({ installDir: '/proj' });

    expect(result).toBe(NextJsRouter.APP_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.log.warn).toHaveBeenCalled();
  });

  it('ambiguous detection in ci mode defaults to app router with a warning (no prompt)', async () => {
    setInteractionMode({ mode: 'ci', source: 'env' });
    mockDetection({ pages: true, app: true });

    const result = await getNextJsRouter({ installDir: '/proj' });

    expect(result).toBe(NextJsRouter.APP_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
    expect(ui.log.warn).toHaveBeenCalled();
  });

  it('recognizes a legacy programmatic pages selection so the installer can reject it', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    mockDetection({ pages: true, app: true });

    const result = await getNextJsRouter({ installDir: '/proj', router: 'pages' });

    expect(() => assertSupportedNextJsRouter(result)).toThrow('supports App Router only');
    expect(result).toBe(NextJsRouter.PAGES_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
  });

  it('--router app wins over detection with no prompt', async () => {
    setInteractionMode({ mode: 'human', source: 'default' });
    mockDetection({ pages: true, app: false });

    const result = await getNextJsRouter({ installDir: '/proj', router: 'app' });

    expect(result).toBe(NextJsRouter.APP_ROUTER);
    expect(ui.select).not.toHaveBeenCalled();
  });
});
