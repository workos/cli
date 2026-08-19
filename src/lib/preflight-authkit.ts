/**
 * Install preflight: refuse to run over an existing AuthKit install.
 *
 * `workos install` provisions a fresh WorkOS environment and writes its
 * credentials into the project's env file before the installer state machine
 * exists. In a project that already has AuthKit wired up that is data loss, so
 * this guard runs first — prompting on an interactive TTY and hard-failing in
 * agent/CI/JSON mode, with `--force` as the escape hatch.
 */

import { AUTHKIT_PACKAGES } from '../doctor/checks/sdk.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { isPromptAllowed } from '../utils/interaction-mode.js';
import { exitWithError, isJsonMode } from '../utils/output.js';
import { getPackageVersion, readPackageJson } from '../utils/package-json.js';
import ui from '../utils/ui.js';

export interface DetectedAuthKitPackage {
  name: string;
  version: string;
}

/**
 * Every AuthKit SDK present in the project, not just the first — the warning
 * should name everything it found.
 *
 * An unreadable or malformed package.json reads as "no AuthKit": a parse
 * failure must not block a run.
 */
export function detectExistingAuthKit(installDir: string): DetectedAuthKitPackage[] {
  const packageJson = readPackageJson(installDir);
  if (!packageJson) return [];

  return [...AUTHKIT_PACKAGES]
    .map((name) => ({ name, version: getPackageVersion(name, packageJson) }))
    .filter((pkg): pkg is DetectedAuthKitPackage => !!pkg.version);
}

/**
 * Stop the install before anything is written when AuthKit is already present.
 *
 * Must be called BEFORE credential resolution — provisioning writes the env
 * file, so a guard that runs afterwards is no guard at all.
 */
export async function assertNoExistingAuthKit(opts: { installDir: string; force?: boolean }): Promise<void> {
  if (opts.force) return;

  const found = detectExistingAuthKit(opts.installDir);
  if (found.length === 0) return;

  const summary = found.map((pkg) => `${pkg.name} ${pkg.version}`).join(', ');

  // Non-interactive: never prompt, never write. `--json` on a real TTY leaves
  // interaction mode human (so isPromptAllowed() is still true) while output is
  // machine-readable, so it has to be excluded too — otherwise the prompt below
  // writes plain text into the JSON stream and fails as `prompt_unavailable`
  // instead of `authkit_already_installed`.
  if (!isPromptAllowed() || isJsonMode()) {
    exitWithError({
      code: 'authkit_already_installed',
      message:
        `AuthKit is already installed in ${opts.installDir} (${summary}). ` +
        `Continuing would provision a new WorkOS environment and rewrite your env file. ` +
        `Run \`${formatWorkOSCommand('doctor')}\` to inspect the existing install, or pass --force to override.`,
    });
  }

  // Interactive: show what was found, then ask. Name the env file explicitly —
  // it is exactly what is at risk.
  const { readProjectEnvCredentials, resolveProjectEnvPath } = await import('./project-env.js');
  const projectEnv = readProjectEnvCredentials(opts.installDir);
  ui.log.warn('AuthKit is already installed here');
  ui.rows(found.map((pkg) => ({ key: pkg.name, value: pkg.version, statusKind: 'muted' as const })));
  // Only promise a rewrite when one can actually happen: with a key already on
  // disk, credential resolution refuses to provision and logs in instead, so
  // continuing changes code only.
  ui.log.info(
    projectEnv.apiKey
      ? `Your existing WorkOS credentials in ${projectEnv.apiKeyPath ?? resolveProjectEnvPath(opts.installDir)} will be kept — continuing changes code only.`
      : `Continuing will provision a new WorkOS environment and rewrite ${resolveProjectEnvPath(opts.installDir)}.`,
  );
  ui.log.info(`To inspect the existing install instead:  ${formatWorkOSCommand('doctor')}`);

  const proceed = await ui.confirm({ message: 'Continue anyway?' });
  if (ui.isCancel(proceed) || !proceed) {
    exitWithCode(ExitCode.CANCELLED, { code: 'cancelled', message: 'Install cancelled.' });
  }
}
