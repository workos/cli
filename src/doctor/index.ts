import { checkSdk } from './checks/sdk.js';
import { checkFramework } from './checks/framework.js';
import { checkRuntime } from './checks/runtime.js';
import { checkEnvironment } from './checks/environment.js';
import { checkConnectivity } from './checks/connectivity.js';
import { detectIssues } from './issues.js';
import type { DoctorOptions, DoctorReport } from './types.js';

const DOCTOR_VERSION = '1.0.0';

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  // Run all checks concurrently where possible
  const [sdk, framework, runtime, connectivity] = await Promise.all([
    checkSdk(options),
    checkFramework(options),
    checkRuntime(options),
    checkConnectivity(options),
  ]);

  // Environment check is synchronous
  const environment = checkEnvironment();

  // Build partial report
  const partialReport = {
    version: DOCTOR_VERSION,
    timestamp: new Date().toISOString(),
    project: {
      path: options.installDir,
      packageManager: runtime.packageManager,
    },
    sdk,
    runtime,
    framework,
    environment,
    connectivity,
  };

  // Detect issues based on collected data
  const issues = detectIssues(partialReport);

  // Calculate summary
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.filter((i) => i.severity === 'warning').length;

  const report: DoctorReport = {
    ...partialReport,
    issues,
    summary: {
      errors,
      warnings,
      healthy: errors === 0,
    },
  };

  return report;
}

export { formatReport } from './output.js';
export type { DoctorReport, DoctorOptions } from './types.js';
