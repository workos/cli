import Chalk from 'chalk';
import type { DoctorReport, Issue } from './types.js';

const DOCTOR_VERSION = '1.0.0';

export function formatReport(report: DoctorReport): void {
  console.log('');
  console.log(Chalk.cyan(`WorkOS Doctor v${DOCTOR_VERSION}`));
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

  // Connectivity
  console.log('');
  console.log('Connectivity');
  if (report.connectivity.apiReachable) {
    console.log(`   API:              ${Chalk.green('✓')} Reachable (${report.connectivity.latencyMs}ms)`);
  } else if (report.connectivity.error?.includes('Skipped')) {
    console.log(`   API:              ${Chalk.dim('Skipped (--no-api)')}`);
  } else {
    console.log(`   API:              ${Chalk.red('✗')} ${report.connectivity.error}`);
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
