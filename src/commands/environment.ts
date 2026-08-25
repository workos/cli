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
import { runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { isJsonMode, outputJson, outputSuccess } from '../utils/output.js';

interface EnvironmentNode {
  id: string;
  name: string | null;
  sandbox?: boolean | null;
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
