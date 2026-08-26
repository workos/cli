/**
 * `workos environment` — account-plane environment lifecycle.
 *
 * These operate on *WorkOS environments* (the server-side environments that hang
 * off a project/team), via the dashboard account plane with the user's OAuth
 * bearer — distinct from `workos env`, which manages *local* CLI environment
 * profiles (API keys / endpoints stored on this machine). See the Phase 3
 * naming decision in the spec.
 *
 * The underlying capability is the same OAuth-bearer dashboard access `whoami`
 * uses — enabled in production but gated by a per-team feature flag
 * (fail-closed); a flag-off or non-team token fails cleanly via the shared
 * error taxonomy.
 */

import chalk from 'chalk';
import { runEnvScopedOperation, runTeamScopedOperation } from '../lib/dashboard-operation.js';
import { requireCommandToken } from '../lib/command-auth.js';
import {
  fetchTeamEnvironments,
  formatEnvironmentLabel,
  healProfiles,
  promptForEnvironment,
  type TeamEnvironment,
} from '../lib/environment-target.js';
import { getConfig, setProfileEnvironmentId } from '../lib/config-store.js';
import { reportDashboardError } from '../catalog/operation.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { isPromptAllowed } from '../utils/interaction-mode.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { formatTable } from '../utils/table.js';

interface EnvironmentNode {
  id: string;
  name: string | null;
  sandbox?: boolean | null;
  clientId?: string | null;
}

interface ProjectWithEnvironments {
  name: string | null;
  environments: EnvironmentNode[] | null;
}

export async function runEnvironmentList(): Promise<void> {
  // Team-scoped read: deliberately NO environment header (see environment-target.ts).
  const { data } = await runTeamScopedOperation<{
    currentTeam: { projectsV2: ProjectWithEnvironments[] | null } | null;
  }>('teamProjectsV2');

  const projects = data.currentTeam?.projectsV2 ?? [];
  const nodes = projects.flatMap((project) =>
    (project.environments ?? []).map((env) => ({ ...env, projectName: project.name })),
  );

  // The list is fresh in hand — heal before marking so the ▸ reflects any
  // just-repaired targeting, and so a stale name never survives this command.
  healProfiles(getConfig(), nodes);
  // Re-read post-heal: the marker must reflect any just-repaired targeting.
  const after = getConfig();
  const targetedId = after?.activeEnvironment ? after.environments[after.activeEnvironment]?.environmentId : undefined;
  const environments = nodes.map((env) => ({ ...env, targeted: env.id === targetedId }));

  if (isJsonMode()) {
    outputJson({
      environments: environments.map((env) => ({
        id: env.id,
        name: env.name ?? null,
        sandbox: env.sandbox ?? false,
        project: env.projectName ?? null,
        targeted: env.targeted,
      })),
    });
    return;
  }

  if (environments.length === 0) {
    console.log('No environments found.');
    return;
  }

  const rows = environments.map((env) => [
    env.targeted ? '▸' : '',
    env.name ?? '—',
    env.id,
    env.projectName ?? '—',
    env.sandbox ? 'Sandbox' : 'Production',
  ]);
  console.log(
    formatTable(
      [{ header: '' }, { header: 'Name' }, { header: 'ID' }, { header: 'Project' }, { header: 'Type' }],
      rows,
    ),
  );

  const profileName = getConfig()?.activeEnvironment;
  if (targetedId && profileName) {
    console.log(chalk.dim(`\n  ▸ targeted by the active profile (${profileName})`));
  }
}

export async function runEnvironmentUse(environmentIdArg?: string): Promise<void> {
  const config = getConfig();
  const activeName = config?.activeEnvironment;
  if (!activeName) {
    exitWithError({
      code: 'no_active_environment',
      message: `No active environment profile. Run \`${formatWorkOSCommand('auth login')}\` or \`${formatWorkOSCommand('profile add')}\` first.`,
    });
  }

  const token = await requireCommandToken();
  let environments: TeamEnvironment[];
  try {
    environments = await fetchTeamEnvironments(token);
  } catch (error) {
    reportDashboardError(error);
  }
  healProfiles(config, environments);

  let targetId: string;
  if (environmentIdArg) {
    // Validate like the resolver does: an unrecognized ID stored on the
    // profile would hit the server's silent production fallback on next use.
    if (!environments.some((env) => env.id === environmentIdArg)) {
      exitWithError({
        code: 'not_found',
        message: `Environment "${environmentIdArg}" was not found in your WorkOS team. Run \`${formatWorkOSCommand('environment list')}\` to see available environments.`,
      });
    }
    targetId = environmentIdArg;
  } else {
    if (!isPromptAllowed()) {
      exitWithError({
        code: 'missing_args',
        message: `Environment ID required when prompting is unavailable. Run \`${formatWorkOSCommand('environment list')}\` to see available IDs.`,
      });
    }
    const choice = await promptForEnvironment(environments);
    if (choice === null) exitWithCode(ExitCode.CANCELLED);
    targetId = choice;
  }

  const chosen = environments.find((env) => env.id === targetId);
  setProfileEnvironmentId(activeName, chosen!.id, chosen!.name, chosen!.projectName);

  outputSuccess(`Active profile ${chalk.bold(activeName)} now targets ${chalk.bold(formatEnvironmentLabel(chosen!))}`, {
    profile: activeName,
    environmentId: chosen!.id,
    environmentName: chosen!.name ?? null,
    projectName: chosen!.projectName ?? null,
  });
}

export interface EnvironmentCreateOptions {
  name: string;
  sandbox: boolean;
  /** `--environment-id` override for this invocation. */
  environmentId?: string;
}

export async function runEnvironmentCreate(options: EnvironmentCreateOptions): Promise<void> {
  // Environment-scoped mutation: the new environment's project placement
  // derives from the request's environment context (CreateEnvironmentInput has
  // no project field), so the target is resolved and pre-validated.
  const { data } = await runEnvScopedOperation<{ createEnvironment: { environment: EnvironmentNode } }>(
    'createEnvironment',
    options,
    { input: { name: options.name, isSandbox: options.sandbox } },
  );

  const env = data.createEnvironment.environment;
  if (isJsonMode()) {
    outputJson({ environment: env });
    return;
  }
  outputSuccess(`Created environment ${chalk.bold(env.name ?? env.id)}${env.sandbox ? chalk.dim(' (sandbox)') : ''}`);
  console.log(chalk.dim(`  env id: ${env.id}`));
}

export interface EnvironmentRenameOptions {
  environmentId: string;
  name: string;
}

export async function runEnvironmentRename(options: EnvironmentRenameOptions): Promise<void> {
  // Environment-scoped mutation: the explicit positional is the target — it is
  // pre-validated against the team so a mistyped ID errors instead of hitting
  // the server's silent production fallback.
  const { data } = await runEnvScopedOperation<{ renameEnvironment: { environment: EnvironmentNode } }>(
    'renameEnvironment',
    options,
    (environmentId) => ({ input: { environmentId, name: options.name } }),
  );

  const env = data.renameEnvironment.environment;
  if (isJsonMode()) {
    outputJson({ environment: env });
    return;
  }
  outputSuccess(`Renamed environment to ${chalk.bold(env.name ?? env.id)}`);
  console.log(chalk.dim(`  env id: ${env.id}`));
}
