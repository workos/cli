/**
 * `workos project` — account-plane project lifecycle.
 *
 * Projects group a team's environments. These commands run against the dashboard
 * account plane with the user's OAuth bearer (the same gated capability `whoami`
 * uses). `project create` provisions a project plus fresh environments, so it is
 * a `require-flag` operation: a non-interactive caller must pass `--yes` (the
 * "don't let a CI loop spawn many projects" guard).
 *
 * Every operation here is team-scoped (projects hang off the team, not an
 * environment), so no environment header is sent (see
 * `src/lib/environment-target.ts`).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { requireConfirmationFlag } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

interface ProjectNode {
  id: string;
  name: string | null;
}

export interface ProjectCreateOptions {
  name: string;
  /** When false, only a staging environment is provisioned (no production env). */
  production: boolean;
  yes?: boolean;
  json?: boolean;
}

export async function runProjectCreate(options: ProjectCreateOptions): Promise<void> {
  // require-flag: non-interactive callers must pass --yes before provisioning.
  await requireConfirmationFlag(options, { action: `create project "${options.name}"` });

  const token = await requireCommandToken();
  const op = getOperation('createProjectWithNewEnvironments');

  let data: {
    createProjectWithNewEnvironments:
      | { __typename: 'ProjectCreated'; project: ProjectNode }
      | { __typename: 'ProjectNameAlreadyUsed'; name: string }
      | { __typename: string };
  };
  // Team-scoped operation: deliberately NO environment header (see environment-target.ts).
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { name: options.name, includeProductionEnvironment: options.production } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.createProjectWithNewEnvironments;
  if (result.__typename === 'ProjectNameAlreadyUsed') {
    exitWithError({
      code: 'name_already_used',
      message: `A project named "${options.name}" already exists in this team.`,
    });
  }
  if (result.__typename !== 'ProjectCreated' || !('project' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not create project "${options.name}".` });
  }

  const project = (result as { project: ProjectNode }).project;
  if (isJsonMode()) {
    outputJson({ project });
    return;
  }
  outputSuccess(`Created project ${chalk.bold(project.name ?? project.id)}`);
  console.log(chalk.dim(`  project id: ${project.id}`));
}

export interface ProjectRenameOptions {
  projectId: string;
  name: string;
}

export async function runProjectRename(options: ProjectRenameOptions): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('renameProject');

  let data: {
    renameProject:
      | { __typename: 'ProjectRenamed'; project: ProjectNode }
      | { __typename: 'ProjectNameAlreadyUsed'; name: string }
      | { __typename: 'ProjectNotFound'; projectId: string }
      | { __typename: string };
  };
  // Team-scoped operation: deliberately NO environment header (see environment-target.ts).
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { projectId: options.projectId, name: options.name } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.renameProject;
  if (result.__typename === 'ProjectNameAlreadyUsed') {
    exitWithError({
      code: 'name_already_used',
      message: `A project named "${options.name}" already exists in this team.`,
    });
  }
  if (result.__typename === 'ProjectNotFound') {
    exitWithError({ code: 'not_found', message: `Project "${options.projectId}" was not found.` });
  }
  if (result.__typename !== 'ProjectRenamed' || !('project' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not rename project "${options.projectId}".` });
  }

  const project = (result as { project: ProjectNode }).project;
  if (isJsonMode()) {
    outputJson({ project });
    return;
  }
  outputSuccess(`Renamed project to ${chalk.bold(project.name ?? project.id)}`);
  console.log(chalk.dim(`  project id: ${project.id}`));
}

interface ProjectListNode {
  id: string;
  name: string | null;
  environments: Array<{ id: string; name: string | null; sandbox?: boolean | null }>;
}

export async function runProjectList(): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('teamProjectsV2');

  let data: { currentTeam: { id: string; projectsV2: ProjectListNode[] } | null };
  // Team-scoped operation: deliberately NO environment header (see environment-target.ts).
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), { token });
  } catch (error) {
    reportDashboardError(error);
  }

  const projects = data.currentTeam?.projectsV2 ?? [];
  if (isJsonMode()) {
    outputJson({ projects });
    return;
  }

  if (projects.length === 0) {
    console.log('No projects found.');
    return;
  }

  const rows = projects.map((project) => [
    project.id,
    project.name ?? chalk.dim('(unnamed)'),
    String(project.environments?.length ?? 0),
  ]);
  console.log(formatTable([{ header: 'ID' }, { header: 'Name' }, { header: 'Environments' }], rows));
}
