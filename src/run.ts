import { readEnvironment } from './utils/environment.js';
import { runWithCore } from './lib/run-with-core.js';
import type { WizardOptions } from './utils/types.js';
import type { Integration } from './lib/constants.js';
import { createWizardEventEmitter } from './lib/events.js';
import path from 'path';
import { EventEmitter } from 'events';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  default?: boolean;
  local?: boolean;
  ci?: boolean;
  skipAuth?: boolean;
  apiKey?: string;
  clientId?: string;
  homepageUrl?: string;
  redirectUri?: string;
  dashboard?: boolean;
  inspect?: boolean;
  noValidate?: boolean;
  noCommit?: boolean;
  direct?: boolean;
};

/**
 * Main entry point for the wizard CLI.
 * Builds options from args and delegates to the core.
 */
export async function runWizard(argv: Args): Promise<void> {
  const options = buildOptions(argv);
  await runWithCore(options);
}

/**
 * Build WizardOptions from CLI args and environment.
 */
function buildOptions(argv: Args): WizardOptions {
  const envArgs = readEnvironment();
  const merged = { ...argv, ...envArgs };

  const installDir = resolveInstallDir(merged.installDir);

  return {
    debug: merged.debug ?? false,
    forceInstall: merged.forceInstall ?? false,
    installDir,
    local: merged.local ?? false,
    ci: merged.ci ?? false,
    skipAuth: merged.skipAuth ?? false,
    apiKey: merged.apiKey,
    clientId: merged.clientId,
    homepageUrl: merged.homepageUrl,
    redirectUri: merged.redirectUri,
    dashboard: merged.dashboard ?? false,
    integration: merged.integration,
    inspect: merged.inspect ?? false,
    noValidate: merged.noValidate ?? false,
    noCommit: merged.noCommit ?? false,
    direct: merged.direct ?? false,
    emitter: createWizardEventEmitter(), // Will be replaced in runWithCore
  };
}

/**
 * Resolve install directory to absolute path.
 */
function resolveInstallDir(dir?: string): string {
  if (!dir) return process.cwd();
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}
