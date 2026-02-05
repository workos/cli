import Chalk from 'chalk';
import type { DoctorReport, Issue } from './types.js';

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
    console.log(`   SDK:              ${report.sdk.name} v${report.sdk.version}`);
  } else {
    console.log(`   SDK:              ${Chalk.red('Not found')}`);
  }
  console.log(`   Runtime:          Node.js ${report.runtime.nodeVersion}`);
  if (report.framework.name) {
    const variant = report.framework.variant ? ` (${report.framework.variant})` : '';
    console.log(`   Framework:        ${report.framework.name} ${report.framework.version}${variant}`);
  }
  if (report.runtime.packageManager) {
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

  // Redirect URI
  if (report.environment.redirectUri) {
    console.log('');
    console.log('Redirect URI');
    console.log(`   Code:             ${report.environment.redirectUri}`);
  }

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

  // Redirect URI comparison
  if (report.redirectUris) {
    console.log('');
    console.log('Redirect URIs');
    const sourceLabel = report.redirectUris.source === 'inferred' ? Chalk.dim(' (inferred from framework)') : '';
    console.log(`   Expected:         ${report.redirectUris.codeUri ?? Chalk.dim('Unknown')}${sourceLabel}`);
    if (report.redirectUris.dashboardUris.length > 0) {
      console.log(`   Dashboard:        ${report.redirectUris.dashboardUris[0]}`);
      for (const uri of report.redirectUris.dashboardUris.slice(1)) {
        console.log(`                     ${uri}`);
      }
    } else {
      console.log(`   Dashboard:        ${Chalk.dim('None configured')}`);
    }
    const matchStatus = report.redirectUris.match ? Chalk.green('✓ Match found') : Chalk.yellow('? No match');
    console.log(`   Status:           ${matchStatus}`);
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

  console.log(Chalk.dim('━'.repeat(70)));
  console.log('');

  // Summary
  if (report.summary.healthy) {
    console.log(Chalk.green('Your WorkOS integration looks healthy!'));
  } else if (report.summary.errors > 0) {
    console.log(Chalk.red(`${report.summary.errors} issue(s) must be resolved before authentication will work.`));
  } else {
    console.log(Chalk.yellow(`${report.summary.warnings} warning(s) to review.`));
  }

  console.log('');
  console.log(Chalk.dim('Copy this report: workos doctor --json | pbcopy'));
  console.log(Chalk.dim('Troubleshooting:  https://workos.com/docs/troubleshooting'));
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
