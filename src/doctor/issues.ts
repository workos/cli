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
  REDIRECT_URI_MISMATCH: {
    severity: 'warning' as const,
    message: 'Redirect URI not found in dashboard configuration',
    docsUrl: 'https://workos.com/docs/authkit/redirect-uri',
  },
  PROD_API_CALL_BLOCKED: {
    severity: 'warning' as const,
    message: 'Dashboard settings not fetched (production API key)',
    remediation: 'Use a staging API key to fetch dashboard settings',
  },
  INVALID_API_KEY: {
    severity: 'error' as const,
    message: 'API key is invalid or expired',
    remediation: 'Check your WORKOS_API_KEY in the WorkOS dashboard',
    docsUrl: 'https://dashboard.workos.com/api-keys',
  },
  CLIENT_ID_MISMATCH: {
    severity: 'error' as const,
    message: 'Client ID does not match the API key environment',
    remediation: 'Ensure WORKOS_CLIENT_ID matches the environment for your API key',
    docsUrl: 'https://dashboard.workos.com/configuration',
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

  // Note: Redirect URI mismatch detection disabled - WorkOS API doesn't expose
  // a public endpoint to list configured redirect URIs for verification

  // Production key warning (no dashboard data)
  if (report.environment.apiKeyType === 'production' && !report.dashboardSettings) {
    issues.push({
      code: 'PROD_API_CALL_BLOCKED',
      ...ISSUE_DEFINITIONS.PROD_API_CALL_BLOCKED,
    });
  }

  // Credential validation issues
  if (report.credentialValidation) {
    if (!report.credentialValidation.valid) {
      issues.push({
        code: 'INVALID_API_KEY',
        ...ISSUE_DEFINITIONS.INVALID_API_KEY,
        details: { error: report.credentialValidation.error },
      });
    } else if (!report.credentialValidation.clientIdMatch) {
      issues.push({
        code: 'CLIENT_ID_MISMATCH',
        ...ISSUE_DEFINITIONS.CLIENT_ID_MISMATCH,
        details: { error: report.credentialValidation.error },
      });
    }
  }

  // Auth pattern findings — map directly to issues
  if (report.authPatterns) {
    for (const finding of report.authPatterns.findings) {
      issues.push({
        code: finding.code,
        severity: finding.severity,
        message: finding.message,
        remediation: finding.remediation,
        docsUrl: finding.docsUrl,
      });
    }
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
