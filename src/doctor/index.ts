import { checkSdk } from './checks/sdk.js';
import { checkFramework } from './checks/framework.js';
import { checkRuntime } from './checks/runtime.js';
import { checkLanguage } from './checks/language.js';
import { checkEnvironment } from './checks/environment.js';
import { checkConnectivity } from './checks/connectivity.js';
import { checkDashboardSettings, compareRedirectUris } from './checks/dashboard.js';
import { checkAuthPatterns } from './checks/auth-patterns.js';
import { checkAiAnalysis } from './checks/ai-analysis.js';
import { checkSkills } from './checks/skills.js';
import { refreshWorkOSSkills } from '../commands/install-skill.js';
import { detectIssues } from './issues.js';
import { formatReport } from './output.js';
import { formatReportAsJson } from './json-output.js';
import { copyToClipboard } from './clipboard.js';
import Chalk from 'chalk';
import type { DoctorOptions, DoctorReport, SkillsRefreshResult } from './types.js';

const DOCTOR_VERSION = '1.0.0';

/**
 * Skills `--fix` is allowed to refresh. Hardcoded — NOT derived from
 * discoverSkills — so future bundled skills require an explicit opt-in here
 * before doctor will write to their target directory. This is the contract's
 * promise that `--fix` only ever touches `workos/` and `workos-widgets/`.
 */
export const FIXABLE_SKILLS = ['workos', 'workos-widgets'] as const;

/**
 * Refresh stale WorkOS skills if `--fix` is set and at least one agent is
 * stale or has no marker. Always re-reads `checkSkills()` after a successful
 * refresh so detectIssues sees the post-refresh state and we don't ship a
 * doctor report that simultaneously claims "fixed" and "still stale".
 *
 * Extracted from runDoctor for unit testability — runDoctor itself depends on
 * eight upstream checks that are expensive to mock.
 */
export async function maybeRefreshSkills(
  options: Pick<DoctorOptions, 'fix'>,
  skills: DoctorReport['skills'],
): Promise<{
  skillsRefresh?: SkillsRefreshResult;
  skills: DoctorReport['skills'];
}> {
  if (!options.fix || !skills) return { skills };

  const stalePresent = skills.agents.some((a) => a.stale || a.installedVersion === null);
  if (!stalePresent) return { skills };

  const refresh = await refreshWorkOSSkills({
    // Explicit allowlist — NOT discoverSkills — so the contract's
    // workos/+workos-widgets-only constraint can't drift.
    skills: [...FIXABLE_SKILLS],
  });
  if (!refresh) return { skills };

  return {
    skillsRefresh: {
      before: refresh.perAgentBefore,
      after: refresh.perAgentAfter,
      skillsInstalled: refresh.skills,
    },
    skills: (await checkSkills()) ?? undefined,
  };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  // Environment check first - loads project's .env/.env.local files
  // Must run before connectivity so the resolved base URL is available
  const { info: environment, raw: envRaw } = checkEnvironment(options);

  // Run remaining checks concurrently
  const [sdk, framework, runtime, connectivity, language] = await Promise.all([
    checkSdk(options),
    checkFramework(options),
    checkRuntime(options),
    checkConnectivity(options, environment.baseUrl ?? 'https://api.workos.com'),
    checkLanguage(options.installDir),
  ]);

  let skills = (await checkSkills()) ?? undefined;

  // `--fix`: refresh stale WorkOS skills BEFORE earlyIssues + AI analysis so
  // every downstream consumer (issue detection, AI prompt context) sees the
  // post-refresh skill state and doesn't reference a SKILLS_OUTDATED warning
  // that was just resolved.
  const refreshOutcome = await maybeRefreshSkills(options, skills);
  const skillsRefresh = refreshOutcome.skillsRefresh;
  skills = refreshOutcome.skills;

  // Dashboard settings + auth patterns + AI analysis (parallel, all need sdk/framework results)
  // AI analysis also receives early issues as context to avoid duplication
  const earlyIssues = detectIssues({
    version: DOCTOR_VERSION,
    timestamp: '',
    project: { path: options.installDir, packageManager: runtime.packageManager },
    sdk,
    language,
    runtime,
    framework,
    environment,
    connectivity,
    skills,
  });

  const [dashboardResult, authPatterns, aiAnalysis] = await Promise.all([
    checkDashboardSettings(options, environment.apiKeyType, envRaw),
    checkAuthPatterns(options, framework, environment, sdk),
    checkAiAnalysis(
      { installDir: options.installDir, language, framework, sdk, environment, existingIssues: earlyIssues },
      { skipAi: options.skipAi },
    ),
  ]);

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
    language,
    runtime,
    framework,
    environment,
    connectivity,
    credentialValidation: dashboardResult.credentialValidation,
    dashboardSettings: dashboardResult.settings ?? undefined,
    dashboardError: dashboardResult.settings ? undefined : dashboardResult.error,
    redirectUris,
    authPatterns,
    aiAnalysis,
    skills,
    skillsRefresh,
  };

  // Detect issues based on (post-refresh) data.
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
