import { checkSdk } from './checks/sdk.js';
import { checkFramework } from './checks/framework.js';
import { checkRuntime } from './checks/runtime.js';
import { checkEnvironment } from './checks/environment.js';
import { checkConnectivity } from './checks/connectivity.js';
import { checkDashboardSettings, compareRedirectUris, validateCredentials } from './checks/dashboard.js';
import { detectIssues } from './issues.js';
import { formatReport } from './output.js';
import { formatReportAsJson } from './json-output.js';
import { copyToClipboard } from './clipboard.js';
import Chalk from 'chalk';
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

  // Environment check - loads project's .env/.env.local files
  const { info: environment, raw: envRaw } = checkEnvironment(options);

  // Validate credentials against API (staging only)
  const credentialValidation = await validateCredentials(environment.apiKeyType, envRaw, options.skipApi);

  // Dashboard settings (only for staging, non-blocking)
  const dashboardResult = await checkDashboardSettings(options, environment.apiKeyType, envRaw);

  // Compute expected redirect URI from framework detection if not set in env
  const redirectUriSource: 'env' | 'inferred' = environment.redirectUri ? 'env' : 'inferred';
  const expectedRedirectUri =
    environment.redirectUri ??
    (framework.expectedCallbackPath && framework.detectedPort
      ? `http://localhost:${framework.detectedPort}${framework.expectedCallbackPath}`
      : null);

  // Compare redirect URIs if we have dashboard data
  const redirectUris = dashboardResult.settings
    ? compareRedirectUris(expectedRedirectUri, dashboardResult.settings.redirectUris, redirectUriSource)
    : undefined;

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
    credentialValidation: credentialValidation ?? undefined,
    dashboardSettings: dashboardResult.settings ?? undefined,
    dashboardError: dashboardResult.settings ? undefined : dashboardResult.error,
    redirectUris,
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

export async function outputReport(report: DoctorReport, options: DoctorOptions): Promise<void> {
  if (options.json) {
    const json = formatReportAsJson(report);
    console.log(json);

    if (options.copy) {
      const success = await copyToClipboard(json);
      if (success) {
        console.error('(Copied to clipboard)');
      }
    }
  } else {
    formatReport(report, { verbose: options.verbose });

    if (options.copy) {
      const json = formatReportAsJson(report);
      const success = await copyToClipboard(json);
      if (success) {
        console.log(Chalk.dim('Report copied to clipboard'));
      }
    }
  }
}

export { formatReport } from './output.js';
export { formatReportAsJson } from './json-output.js';
export type { DoctorReport, DoctorOptions } from './types.js';
