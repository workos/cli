import type { Issue, DoctorReport } from './types.js';

export const ISSUE_DEFINITIONS = {
  MISSING_API_KEY: {
    severity: 'error' as const,
    message: 'WORKOS_API_KEY environment variable not set',
    remediation: 'Set WORKOS_API_KEY in your .env.local file',
    docsUrl: 'https://dashboard.workos.com/api-keys',
  },
  MISSING_CLIENT_ID: {
    severity: 'error' as const,
    message: 'WORKOS_CLIENT_ID environment variable not set',
    remediation: 'Set WORKOS_CLIENT_ID in your .env.local file',
    docsUrl: 'https://dashboard.workos.com/configuration',
  },
  SDK_OUTDATED: {
    severity: 'warning' as const,
    message: 'SDK version is outdated',
    // remediation generated dynamically
  },
  COOKIE_DOMAIN_NOT_SET: {
    severity: 'warning' as const,
    message: 'Cookie domain not explicitly set',
    remediation: 'Consider setting WORKOS_COOKIE_DOMAIN for cross-subdomain auth',
    docsUrl: 'https://workos.com/docs/authkit/cookie-domain',
  },
  NO_SDK_FOUND: {
    severity: 'error' as const,
    message: 'No WorkOS SDK found in dependencies',
    remediation: 'Install a WorkOS SDK: npm install @workos-inc/authkit-nextjs',
    docsUrl: 'https://workos.com/docs',
  },
  API_UNREACHABLE: {
    severity: 'warning' as const,
    message: 'Cannot reach WorkOS API',
    // remediation generated dynamically based on error
  },
};

export function detectIssues(report: Omit<DoctorReport, 'issues' | 'summary'>): Issue[] {
  const issues: Issue[] = [];

  // SDK issues
  if (!report.sdk.name) {
    issues.push({ code: 'NO_SDK_FOUND', ...ISSUE_DEFINITIONS.NO_SDK_FOUND });
  } else if (report.sdk.outdated && report.sdk.version && report.sdk.latest) {
    issues.push({
      code: 'SDK_OUTDATED',
      severity: 'warning',
      message: `SDK version outdated (${report.sdk.version} → ${report.sdk.latest})`,
      remediation: `Run: ${getUpdateCommand(report.runtime.packageManager, report.sdk.name)}`,
      details: { installed: report.sdk.version, latest: report.sdk.latest },
    });
  }

  // Environment issues
  if (!report.environment.apiKeyConfigured) {
    issues.push({ code: 'MISSING_API_KEY', ...ISSUE_DEFINITIONS.MISSING_API_KEY });
  }

  if (!report.environment.clientId) {
    issues.push({ code: 'MISSING_CLIENT_ID', ...ISSUE_DEFINITIONS.MISSING_CLIENT_ID });
  }

  if (report.sdk.isAuthKit && !report.environment.cookieDomain) {
    issues.push({ code: 'COOKIE_DOMAIN_NOT_SET', ...ISSUE_DEFINITIONS.COOKIE_DOMAIN_NOT_SET });
  }

  // Connectivity issues
  if (!report.connectivity.apiReachable && !report.connectivity.error?.includes('Skipped')) {
    issues.push({
      code: 'API_UNREACHABLE',
      severity: 'warning',
      message: `Cannot reach WorkOS API: ${report.connectivity.error}`,
      remediation: 'Check your network connection and firewall settings',
    });
  }

  return issues;
}

function getUpdateCommand(packageManager: string | null, sdkName: string): string {
  switch (packageManager) {
    case 'pnpm':
      return `pnpm update ${sdkName}`;
    case 'Yarn V1':
    case 'Yarn V2/3/4':
      return `yarn upgrade ${sdkName}`;
    case 'Bun':
      return `bun update ${sdkName}`;
    default:
      return `npm update ${sdkName}`;
  }
}
