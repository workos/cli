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
 * uses, which is feature-flag-gated server-side (staging today); a flag-off or
 * non-team token fails cleanly via the shared error taxonomy.
 */

import chalk from 'chalk';
import { getAccessToken } from '../lib/credentials.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { isJsonMode, outputJson, outputSuccess } from '../utils/output.js';
import { exitWithAuthRequired } from '../utils/exit-codes.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

interface EnvironmentNode {
  id: string;
  name: string | null;
  sandbox?: boolean | null;
}

function requireToken(): string {
  const token = getAccessToken();
  if (!token) {
    exitWithAuthRequired(`Not logged in. Run \`${formatWorkOSCommand('auth login')}\` to authenticate.`);
  }
  return token;
}

export interface EnvironmentCreateOptions {
  name: string;
  sandbox: boolean;
}

export async function runEnvironmentCreate(options: EnvironmentCreateOptions): Promise<void> {
  const token = requireToken();
  const op = getOperation('createEnvironment');

  let data: { createEnvironment: { environment: EnvironmentNode } };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { name: options.name, isSandbox: options.sandbox } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

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
  const token = requireToken();
  const op = getOperation('renameEnvironment');

  let data: { renameEnvironment: { environment: EnvironmentNode } };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { environmentId: options.environmentId, name: options.name } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const env = data.renameEnvironment.environment;
  if (isJsonMode()) {
    outputJson({ environment: env });
    return;
  }
  outputSuccess(`Renamed environment to ${chalk.bold(env.name ?? env.id)}`);
  console.log(chalk.dim(`  env id: ${env.id}`));
}
