import chalk from 'chalk';
import {
  envTelemetryOverride,
  getTelemetrySource,
  isTelemetryEnabled,
  isTelemetryOptedOut,
  setTelemetryOptedOut,
  type TelemetrySource,
} from '../lib/preferences.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

/**
 * Persist an opt-out/opt-in change, surfacing a clear error if the write fails
 * (read-only FS, permission denied). Unlike the read path, the command path
 * must NOT swallow a write failure — otherwise the user believes their
 * preference persisted when it did not.
 */
function persistOptedOut(value: boolean): void {
  try {
    setTelemetryOptedOut(value);
  } catch {
    exitWithError({
      code: 'internal_error',
      message: `Could not save telemetry preference to disk. Your preference was NOT persisted.`,
    });
  }
}

export async function runTelemetryOptOut(): Promise<void> {
  const alreadyOptedOut = isTelemetryOptedOut();
  persistOptedOut(true);

  if (isJsonMode()) {
    outputJson({ status: 'ok', optedOut: true, alreadyOptedOut });
    return;
  }

  if (alreadyOptedOut) {
    console.log(chalk.green('Telemetry collection is already opted out.'));
  } else {
    console.log(chalk.green('Telemetry collection disabled. No further events will be sent.'));
  }
  console.log(chalk.dim(`Re-enable any time with \`${formatWorkOSCommand('telemetry opt-in')}\`.`));
}

export async function runTelemetryOptIn(): Promise<void> {
  const wasOptedOut = isTelemetryOptedOut();
  persistOptedOut(false);

  if (isJsonMode()) {
    outputJson({ status: 'ok', optedOut: false, alreadyOptedIn: !wasOptedOut });
    return;
  }

  if (wasOptedOut) {
    console.log(chalk.green('Telemetry collection re-enabled.'));
  } else {
    console.log(chalk.green('Telemetry collection is already enabled.'));
  }
  console.log(chalk.dim(`Opt out any time with \`${formatWorkOSCommand('telemetry opt-out')}\`.`));
}

function describeSource(source: TelemetrySource): string {
  switch (source) {
    case 'env':
      return 'WORKOS_TELEMETRY environment variable';
    case 'preference':
      return 'saved preference';
    case 'default':
      return 'default';
  }
}

export async function runTelemetryStatus(): Promise<void> {
  const enabled = isTelemetryEnabled();
  const optedOut = isTelemetryOptedOut();
  const source = getTelemetrySource();
  const override = envTelemetryOverride();

  if (isJsonMode()) {
    outputJson({
      enabled,
      optedOut,
      source,
      envOverride: override ?? null,
    });
    return;
  }

  const stateLine = enabled
    ? chalk.green('Telemetry collection is enabled.')
    : chalk.yellow('Telemetry collection is disabled.');
  console.log(stateLine);
  console.log(chalk.dim(`Source: ${describeSource(source)}.`));

  if (enabled) {
    console.log(chalk.dim(`Opt out with \`${formatWorkOSCommand('telemetry opt-out')}\`.`));
  } else {
    console.log(chalk.dim(`Re-enable with \`${formatWorkOSCommand('telemetry opt-in')}\`.`));
  }
}
