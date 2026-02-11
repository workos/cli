import { detectAllPackageManagers } from '../../utils/package-manager.js';
import { execFileNoThrow } from '../../utils/exec-file.js';
import type { DoctorOptions, RuntimeInfo } from '../types.js';

export async function checkRuntime(options: DoctorOptions): Promise<RuntimeInfo> {
  const nodeVersion = process.version;

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
