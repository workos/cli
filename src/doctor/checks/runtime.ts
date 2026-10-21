import { detectAllPackageManagers } from '../../utils/package-manager.js';
import { execFileNoThrow } from '../../utils/exec-file.js';
import type { DoctorOptions, RuntimeInfo } from '../types.js';

export async function checkRuntime(options: DoctorOptions): Promise<RuntimeInfo> {
  // The CLI is a compiled Bun binary, so process.version is Bun's baked-in
  // Node-compat constant — probe the host's actual Node.js instead, since
  // this reports on the user's project environment.
  let nodeVersion: string | null = null;
  const nodeResult = await execFileNoThrow('node', ['--version']);
  if (nodeResult.status === 0) {
    nodeVersion = nodeResult.stdout.trim();
  }

  const managers = detectAllPackageManagers(options);
  const primaryManager = managers[0] ?? null;

  let packageManagerVersion: string | null = null;
  if (primaryManager) {
    const result = await execFileNoThrow(primaryManager.name, ['--version']);
    if (result.status === 0) {
      packageManagerVersion = result.stdout.trim();
    }
  }

  return {
    nodeVersion,
    packageManager: primaryManager?.label ?? null,
    packageManagerVersion,
  };
}
