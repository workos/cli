import Chalk from 'chalk';
import type { DoctorReport, Issue } from './types.js';
import { renderSummaryBox, type SummaryBoxItem } from '../utils/summary-box.js';
import type { LockExpression } from '../utils/lock-art.js';

export interface FormatOptions {
  verbose?: boolean;
}

export function formatReport(report: DoctorReport, options?: FormatOptions): void {
  console.log('');
  console.log(Chalk.cyan('WorkOS Doctor'));
  console.log(Chalk.dim('━'.repeat(70)));

  // SDK & Project
  console.log('');
  console.log('SDK & Project Information');
  if (report.sdk.name) {
    console.log(`   SDK:              ${report.sdk.name}${report.sdk.version ? ` v${report.sdk.version}` : ''}`);
  } else {
    console.log(`   SDK:              ${Chalk.red('Not found')}`);
  }
  if (report.language.name !== 'Unknown') {
    console.log(`   Language:         ${report.language.name}`);
  }
  console.log(`   Runtime:          Node.js ${report.runtime.nodeVersion}`);
  if (report.framework.name) {
    const variant = report.framework.variant ? ` (${report.framework.variant})` : '';
    console.log(`   Framework:        ${report.framework.name} ${report.framework.version ?? ''}${variant}`);
  }
  if (report.language.packageManager) {
    console.log(`   Package Manager:  ${report.language.packageManager}`);
  } else if (report.runtime.packageManager) {
    console.log(`   Package Manager:  ${report.runtime.packageManager} ${report.runtime.packageManagerVersion ?? ''}`);
  }

  // Environment
  console.log('');
  console.log('Environment Configuration');
  const envType = report.environment.apiKeyType
    ? report.environment.apiKeyType.charAt(0).toUpperCase() + report.environment.apiKeyType.slice(1)
    : 'Unable to determine';
  console.log(`   Environment:      ${envType}`);
  console.log(`   Client ID:        ${report.environment.clientId ?? Chalk.red('Not set')}`);
  console.log(
    `   API Key:          ${report.environment.apiKeyConfigured ? Chalk.green('configured') : Chalk.red('not set')}`,
  );
  console.log(`   Base URL:         ${report.environment.baseUrl} ${Chalk.green('✓')}`);

  // Connectivity & Credential Validation
  console.log('');
  console.log('Connectivity');
  if (report.connectivity.apiReachable) {
    console.log(`   API:              ${Chalk.green('✓')} Reachable (${report.connectivity.latencyMs}ms)`);
  } else if (report.connectivity.error?.includes('Skipped')) {
    console.log(`   API:              ${Chalk.dim('Skipped (--skip-api)')}`);
  } else {
    console.log(`   API:              ${Chalk.red('✗')} ${report.connectivity.error}`);
  }

  // Credential validation
  if (report.credentialValidation) {
    if (report.credentialValidation.valid && report.credentialValidation.clientIdMatch) {
      console.log(`   Credentials:      ${Chalk.green('✓')} Valid and matching`);
    } else if (!report.credentialValidation.valid) {
      console.log(`   Credentials:      ${Chalk.red('✗')} ${report.credentialValidation.error ?? 'Invalid'}`);
    } else if (!report.credentialValidation.clientIdMatch) {
      console.log(`   Credentials:      ${Chalk.red('✗')} Client ID mismatch`);
    }
  }

  // Dashboard Settings (if available)
  if (report.dashboardSettings) {
    console.log('');
    console.log('Dashboard Settings (Staging)');
    console.log(
      `   Auth Methods:     ${report.dashboardSettings.authMethods.length > 0 ? report.dashboardSettings.authMethods.join(', ') : 'None configured'}`,
    );
    console.log(`   Session Timeout:  ${report.dashboardSettings.sessionTimeout ?? 'Default'}`);
    console.log(`   MFA:              ${formatMfa(report.dashboardSettings.mfa)}`);
    console.log(`   Organizations:    ${report.dashboardSettings.organizationCount} configured`);
  } else if (report.dashboardError) {
    console.log('');
    console.log('Dashboard Settings');
    console.log(`   Status:           ${Chalk.dim(report.dashboardError)}`);
  }

  // Redirect URI (can't verify against dashboard - no list API)
  if (report.redirectUris?.codeUri) {
    console.log('');
    const source = report.redirectUris.source === 'inferred' ? 'Inferred' : 'Configured';
    console.log(`Redirect URI (${source})`);
    console.log(`   ${report.redirectUris.codeUri}`);
  }

  // Auth Patterns
  if (report.authPatterns) {
    console.log('');
    console.log('Auth Patterns');
    if (report.authPatterns.findings.length === 0) {
      console.log(`   ${Chalk.green('✓')} ${report.authPatterns.checksRun} checks passed`);
    } else {
      console.log(
        `   ${report.authPatterns.checksRun} checked, ${Chalk.yellow(`${report.authPatterns.findings.length} finding(s)`)}`,
      );
      for (const finding of report.authPatterns.findings) {
        const icon = finding.severity === 'error' ? Chalk.red('✗') : Chalk.yellow('!');
        console.log(`   ${icon} ${finding.message}`);
        if (finding.filePath) {
          console.log(`     ${Chalk.dim('File:')} ${finding.filePath}`);
        }
      }
    }
  }

  // AI Analysis
  if (report.aiAnalysis) {
    console.log('');
    if (report.aiAnalysis.skipped) {
      console.log('AI Analysis');
      console.log(`   ${Chalk.dim(report.aiAnalysis.skipReason ?? 'Skipped')}`);
    } else {
      const duration = (report.aiAnalysis.durationMs / 1000).toFixed(1);
      console.log(`AI Analysis ${Chalk.dim(`(${duration}s)`)}`);
      if (report.aiAnalysis.summary) {
        console.log(`   ${report.aiAnalysis.summary}`);
      }
      console.log('');
      for (const finding of report.aiAnalysis.findings) {
        const icon =
          finding.severity === 'error'
            ? Chalk.red('✗')
            : finding.severity === 'warning'
              ? Chalk.yellow('!')
              : Chalk.dim('ℹ');
        const color =
          finding.severity === 'error' ? Chalk.red : finding.severity === 'warning' ? Chalk.yellow : Chalk.dim;
        console.log(`   ${icon} ${color(finding.title)}`);
        console.log(`     ${finding.detail}`);
        if (finding.remediation) {
          console.log(`     ${Chalk.dim('→')} ${finding.remediation}`);
        }
        if (finding.filePath) {
          console.log(`     ${Chalk.dim('File:')} ${finding.filePath}`);
        }
        console.log('');
      }
    }
  }

  // Verbose mode additions
  if (options?.verbose) {
    console.log('');
    console.log(Chalk.dim('Verbose Details'));
    console.log(`   ${Chalk.dim('Project path:')}  ${report.project.path}`);
    console.log(`   ${Chalk.dim('Timestamp:')}     ${report.timestamp}`);
    console.log(`   ${Chalk.dim('Doctor version:')} ${report.version}`);
  }

  console.log('');
  console.log(Chalk.dim('━'.repeat(70)));

  // Issues
  if (report.issues.length > 0) {
    const errors = report.issues.filter((i) => i.severity === 'error');
    const warnings = report.issues.filter((i) => i.severity === 'warning');

    console.log('');
    if (errors.length > 0) {
      console.log(Chalk.red(`Critical Issues Found (${errors.length} errors)`));
      console.log('');
      for (const issue of errors) {
        formatIssue(issue);
      }
    }

    if (warnings.length > 0) {
      console.log(Chalk.yellow(`Warnings (${warnings.length})`));
      console.log('');
      for (const issue of warnings) {
        formatIssue(issue);
      }
    }
  }

  console.log('');

  // Summary box with lock character
  const expression: LockExpression = report.summary.healthy
    ? 'success'
    : report.summary.errors > 0
      ? 'error'
      : 'warning';

  const title = report.summary.healthy
    ? 'WorkOS Integration Healthy'
    : report.summary.errors > 0
      ? `${report.summary.errors} Issue(s) Found`
      : `${report.summary.warnings} Warning(s) to Review`;

  const items: SummaryBoxItem[] = report.issues.map((issue) => ({
    type: issue.severity === 'error' ? ('error' as const) : ('pending' as const),
    text: `${issue.code}: ${issue.message}`,
  }));

  console.log(
    renderSummaryBox({
      expression,
      title,
      items,
      footer: 'workos doctor --copy | https://workos.com/docs',
    }),
  );
  console.log('');
}

function formatIssue(issue: Issue): void {
  const icon = issue.severity === 'error' ? Chalk.red('✗') : Chalk.yellow('!');
  const color = issue.severity === 'error' ? Chalk.red : Chalk.yellow;

  console.log(`${icon} ${color(issue.code)}: ${issue.message}`);
  if (issue.remediation) {
    console.log(`   ${Chalk.dim('→')} ${issue.remediation}`);
  }
  if (issue.docsUrl) {
    console.log(`   ${Chalk.dim('Docs:')} ${issue.docsUrl}`);
  }
  console.log('');
}

function formatMfa(mfa: string | null): string {
  switch (mfa) {
    case 'required':
      return 'Required';
    case 'optional':
      return 'Optional';
    case 'disabled':
      return 'Disabled';
    default:
      return 'Not configured';
  }
}
