import { getInteractionMode } from '../../utils/interaction-mode.js';
import { runHostProbe } from '../../lib/host-probe.js';
import type { HostExecutionInfo } from '../types.js';

const HOST_EXECUTION_WARNING =
  'This may be a sandboxed run. Re-run the command on the host shell before trusting auth, config, or API failures.';

export async function checkHostExecution(): Promise<HostExecutionInfo> {
  const interactionMode = getInteractionMode();

  if (interactionMode.mode === 'human') {
    return {
      mode: 'interactive',
      ok: true,
      failures: [],
    };
  }

  const probe = await runHostProbe();
  return {
    mode: 'non-interactive',
    ok: probe.ok,
    failures: probe.failures,
    warning: probe.ok ? undefined : HOST_EXECUTION_WARNING,
  };
}
