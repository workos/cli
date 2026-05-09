import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../utils/interaction-mode.js', () => ({
  getInteractionMode: vi.fn(),
}));

vi.mock('../../lib/host-probe.js', () => ({
  runHostProbe: vi.fn(),
}));

import { checkHostExecution } from './host-execution.js';
import { getInteractionMode } from '../../utils/interaction-mode.js';
import { runHostProbe } from '../../lib/host-probe.js';

describe('checkHostExecution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes without probing in human interaction mode', async () => {
    vi.mocked(getInteractionMode).mockReturnValue({ mode: 'human', source: 'default' });

    const result = await checkHostExecution();

    expect(result).toEqual({ mode: 'interactive', ok: true, failures: [] });
    expect(runHostProbe).not.toHaveBeenCalled();
  });

  it('passes when agent-mode host state is reachable', async () => {
    vi.mocked(getInteractionMode).mockReturnValue({ mode: 'agent', source: 'env' });
    vi.mocked(runHostProbe).mockResolvedValue({ ok: true, failures: [] });

    const result = await checkHostExecution();

    expect(result).toEqual({ mode: 'non-interactive', ok: true, failures: [], warning: undefined });
    expect(runHostProbe).toHaveBeenCalledOnce();
  });

  it('warns when agent-mode host state is blocked', async () => {
    vi.mocked(getInteractionMode).mockReturnValue({ mode: 'agent', source: 'env' });
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

  it('warns when CI-mode host state is blocked', async () => {
    vi.mocked(getInteractionMode).mockReturnValue({ mode: 'ci', source: 'ci_env' });
    vi.mocked(runHostProbe).mockResolvedValue({
      ok: false,
      failures: [{ capability: 'keychain', detail: 'interaction is not allowed' }],
    });

    const result = await checkHostExecution();

    expect(result).toMatchObject({
      mode: 'non-interactive',
      ok: false,
      warning: expect.stringContaining('host shell'),
    });
    expect(runHostProbe).toHaveBeenCalledOnce();
  });
});
