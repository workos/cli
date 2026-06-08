import { checkAuthPatterns } from '../../doctor/checks/auth-patterns.js';
import type { AuthPatternFinding, FrameworkInfo, EnvironmentInfo, SdkInfo } from '../../doctor/types.js';
import type { ValidationIssue } from './types.js';

/**
 * The "security subset" of `workos doctor`'s auth-pattern checks that the
 * installer enforces. These are the patterns that are *unsafe* or *leak secrets*
 * (an unsafe GET sign-out, an API key in client env/source, an ungitignored
 * .env). Completeness checks (missing middleware/callback/provider) are
 * intentionally excluded here — `validateInstallation` already covers those, and
 * they carry higher false-positive risk than we want gating install success.
 *
 * Keep in sync with the codes emitted by `src/doctor/checks/auth-patterns.ts`.
 */
const SECURITY_FINDING_CODES = new Set<string>([
  'SIGNOUT_GET_HANDLER',
  'SIGNOUT_LINK_PREFETCH',
  'API_KEY_LEAKED_TO_CLIENT',
  'API_KEY_IN_SOURCE',
  'ENV_FILE_NOT_GITIGNORED',
  'MIXED_ENVIRONMENT',
]);

/** Map an installer integration id to the framework name doctor's checks expect. */
const INTEGRATION_FRAMEWORK_NAME: Record<string, string> = {
  nextjs: 'Next.js',
  'react-router': 'React Router',
  'tanstack-start': 'TanStack Start',
};

export interface SecurityCheckResult {
  /** All security-class findings for this install (errors + warnings). */
  findings: AuthPatternFinding[];
  /**
   * Error-severity findings that must block a successful install. Empty when the
   * install is secure; a non-empty list means install should not report success.
   */
  blocking: AuthPatternFinding[];
}

/**
 * Run the security subset of doctor's auth-pattern checks against an install
 * directory. Pure file inspection — no network — so it is safe to call both
 * inside the installer's self-correction loop and as the final pre-success gate.
 *
 * This closes the install-validate ↔ doctor gap: previously install could report
 * `success: true` while `workos doctor` immediately found a security hole,
 * because neither the retry loop nor `validateInstallation` ran these checks.
 */
export async function runInstallSecurityChecks(integration: string, installDir: string): Promise<SecurityCheckResult> {
  const framework: FrameworkInfo = {
    name: INTEGRATION_FRAMEWORK_NAME[integration] ?? null,
    version: null,
  };
  // checkAuthPatterns loads .env files itself; these structs only satisfy the
  // shape its non-Next.js checks read from.
  const environment: EnvironmentInfo = {
    apiKeyConfigured: false,
    apiKeyType: null,
    clientId: null,
    redirectUri: null,
    cookieDomain: null,
    baseUrl: null,
  };
  const sdk: SdkInfo = {
    name: null,
    version: null,
    latest: null,
    outdated: false,
    isAuthKit: false,
    language: 'javascript',
  };

  const result = await checkAuthPatterns({ installDir }, framework, environment, sdk);
  const findings = result.findings.filter((f) => SECURITY_FINDING_CODES.has(f.code));
  const blocking = findings.filter((f) => f.severity === 'error');
  return { findings, blocking };
}

/** Convert security findings into ValidationIssues for the emitter/report surfaces. */
export function securityFindingsToIssues(findings: AuthPatternFinding[]): ValidationIssue[] {
  return findings.map((f) => ({
    type: 'pattern',
    severity: f.severity,
    message: f.filePath ? `${f.message} (${f.filePath})` : f.message,
    hint: f.remediation,
  }));
}

/**
 * Build an agent correction prompt from security findings so the installer's
 * self-correction loop fixes them before declaring success. Returns an empty
 * string when there is nothing to correct.
 */
export function formatSecurityFindingsForAgent(findings: AuthPatternFinding[]): string {
  if (findings.length === 0) return '';
  const lines = findings.map((f) => {
    const loc = f.filePath ? ` in ${f.filePath}` : '';
    const fix = f.remediation ? ` Fix: ${f.remediation}` : '';
    return `- [${f.severity}] ${f.message}${loc}.${fix}`;
  });
  return `Security checks found issues that must be fixed:\n\n${lines.join('\n')}\n\nApply the fixes above, then make sure the project still builds.`;
}

/**
 * Build the error message thrown when error-severity security findings survive
 * the installer's retries — the message that turns a silent insecure "success"
 * into a visible failure.
 */
export function formatBlockingSecurityError(blocking: AuthPatternFinding[]): string {
  const lines = blocking.map((f) => {
    const loc = f.filePath ? ` (${f.filePath})` : '';
    return `  • ${f.code}: ${f.message}${loc}`;
  });
  return [
    'Installation produced insecure code that could not be auto-corrected:',
    '',
    ...lines,
    '',
    'Fix the issues above (or run `workos doctor` for details and remediation) and re-run the installer.',
  ].join('\n');
}
