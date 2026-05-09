import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/environment.js', () => ({
  isNonInteractiveEnvironment: vi.fn(),
}));

vi.mock('../../lib/host-probe.js', () => ({
  runHostProbe: vi.fn(),
}));

import { checkHostExecution } from './host-execution.js';
import { isNonInteractiveEnvironment } from '../../utils/environment.js';
import { runHostProbe } from '../../lib/host-probe.js';

describe('checkHostExecution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes without probing in an interactive host shell', async () => {
    vi.mocked(isNonInteractiveEnvironment).mockReturnValue(false);

    const result = await checkHostExecution();

    expect(result).toEqual({ mode: 'interactive', ok: true, failures: [] });
    expect(runHostProbe).not.toHaveBeenCalled();
  });

  it('passes when non-interactive host state is reachable', async () => {
    vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
    vi.mocked(runHostProbe).mockResolvedValue({ ok: true, failures: [] });

    const result = await checkHostExecution();

    expect(result).toEqual({ mode: 'non-interactive', ok: true, failures: [], warning: undefined });
  });

  it('warns when non-interactive host state is blocked', async () => {
    vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
    vi.mocked(runHostProbe).mockResolvedValue({
      ok: false,
      failures: [
        {
          capability: 'home-fs',
          detail: 'EACCES: permission denied',
          operation: 'write',
          target: '/Users/test/.workos',
          label: 'WorkOS home directory',
        },
      ],
    });

    const result = await checkHostExecution();

    expect(result.ok).toBe(false);
    expect(result.warning).toContain('host shell');
    expect(result.failures[0]).toMatchObject({
      capability: 'home-fs',
      operation: 'write',
      label: 'WorkOS home directory',
    });
  });
});
