/**
 * The execution seam for dashboard-plane resource commands: composes auth
 * (`requireCommandToken`), catalog lookup, environment targeting
 * (`resolveEnvironmentTarget`), the wire request, and error reporting, so
 * handlers hold only variable-building and output-shaping.
 *
 * Three layers, matching how call sites classify themselves (see
 * `catalog/operation.ts`):
 *
 * - {@link runEnvScopedOperation} — the full preamble for environment-scoped
 *   operations: the resolved target rides as the environment header (and as a
 *   variable where the operation declares one).
 * - {@link runTeamScopedOperation} — the full preamble for team-scoped
 *   operations, which deliberately send no environment header.
 * - {@link executeDashboardOperation} — request + structured-error exit only,
 *   for flows that resolve their token/environment once and run several
 *   operations against it (read-then-mutate helpers).
 *
 * Environment-scoped operations can also run with an API key (see
 * `resource-auth.ts` for when): {@link resolveEnvScopedAuth} returns the key
 * instead of a bearer, and {@link executeDashboardOperation} routes the
 * operation to its REST adapter (`api-key-operations/`), which returns the same
 * data shape. Team-scoped operations stay session-only.
 */

import { requireCommandToken } from './command-auth.js';
import { dashboardGraphqlRequest, dashboardGraphqlUpload, type DashboardUploadFile } from './dashboard-graphql.js';
import { resolveEnvironmentTarget } from './environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import type { CatalogOperation } from '../catalog/catalog-types.js';
import {
  API_KEY_ENVIRONMENT_ID,
  isApiKeyAuth,
  resolveResourceApiKey,
  type ApiKeyAuth,
  type OperationAuth,
} from './resource-auth.js';
import { apiKeyUnsupportedReason, executeApiKeyOperation, exitApiKeyUnsupported } from './api-key-operations/index.js';
import { exitWithError } from '../utils/output.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

type Variables = Record<string, unknown>;

/**
 * Environment-scoped operations behind account-plane commands (`environment
 * create|rename`). Like the team-scoped ones, they act on the dashboard
 * account and stay session-only even when an API key is present.
 */
const SESSION_ONLY_OPERATIONS = new Set(['createEnvironment', 'renameEnvironment']);

export interface EnvScopedOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** Operation-kind hint retained for read-then-mutate callers. All targets validate. */
  forMutation?: boolean;
}

export interface EnvScopedResult<T> {
  data: T;
  /** The resolved target — for operations that also take it as a variable. */
  environmentId: string;
  /** For follow-up requests within the same invocation (a bearer, or the API key). */
  token: OperationAuth;
  op: CatalogOperation;
}

/** Why `--environment-id` can't be combined with an API key, per key source. */
function environmentFlagConflict(auth: ApiKeyAuth): string {
  if (auth.source === 'unclaimed-profile') {
    return (
      '--environment-id cannot be used while the active profile is an unclaimed environment: ' +
      `its API key already decides the environment. Run \`${formatWorkOSCommand('profile switch')}\` to use another profile.`
    );
  }
  return (
    '--environment-id cannot be combined with an API key: the key already decides the environment. ' +
    'Drop --environment-id, or remove --api-key / WORKOS_API_KEY to use your dashboard login.'
  );
}

/**
 * Resolve the credential and target for an environment-scoped operation.
 *
 * API-key path: the key IS the environment, so there is nothing to resolve;
 * an explicit `--environment-id` is refused rather than silently ignored.
 * Session path: unchanged — a usable bearer plus the validated target.
 */
export async function resolveEnvScopedAuth(options: {
  environmentId?: string;
  forMutation: boolean;
  /** Skip the API-key path (account-plane operations). */
  sessionOnly?: boolean;
}): Promise<{ token: OperationAuth; environmentId: string }> {
  const apiKey = options.sessionOnly ? null : resolveResourceApiKey();
  if (apiKey) {
    if (options.environmentId?.trim()) {
      exitWithError({ code: 'invalid_argument', message: environmentFlagConflict(apiKey) });
    }
    return { token: apiKey, environmentId: API_KEY_ENVIRONMENT_ID };
  }

  const token = await requireCommandToken();
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: options.forMutation,
  });
  return { token, environmentId };
}

/**
 * Execute one operation with an already-resolved token/environment, translating
 * any transport/server failure into a structured exit.
 */
export async function executeDashboardOperation<T>(
  op: CatalogOperation,
  options: { token: OperationAuth; variables?: Variables; environmentId?: string },
): Promise<T> {
  const { token } = options;
  if (isApiKeyAuth(token)) {
    return executeApiKeyOperation<T>(op.name, options.variables, token);
  }
  try {
    return await dashboardGraphqlRequest<T>(resolveExecutableDocument(op), { ...options, token });
  } catch (error) {
    reportDashboardError(error);
  }
}

/**
 * {@link executeDashboardOperation} for an operation carrying file uploads —
 * same already-resolved token/environment contract, same structured exit, but
 * sent as a GraphQL multipart request so `Upload` variables can carry bytes.
 */
export async function executeDashboardUpload<T>(
  op: CatalogOperation,
  options: { token: OperationAuth; variables?: Variables; environmentId?: string; files: DashboardUploadFile[] },
): Promise<T> {
  const { token } = options;
  // File uploads exist only for dashboard-managed assets (branding images).
  if (isApiKeyAuth(token)) exitApiKeyUnsupported(apiKeyUnsupportedReason(op.name));
  try {
    return await dashboardGraphqlUpload<T>(resolveExecutableDocument(op), { ...options, token });
  } catch (error) {
    reportDashboardError(error);
  }
}

/**
 * Run one environment-scoped operation end to end. Handler `options` objects
 * satisfy {@link EnvScopedOptions} structurally, so the common call is
 * `runEnvScopedOperation('organizations', options, (environmentId) => ({ … }))`
 * — pass a plain object instead when the variables don't need the resolved
 * target.
 */
export async function runEnvScopedOperation<T>(
  opName: string,
  options: EnvScopedOptions,
  variables?: Variables | ((environmentId: string) => Variables),
): Promise<EnvScopedResult<T>> {
  const op = getOperation(opName);
  const { token, environmentId } = await resolveEnvScopedAuth({
    environmentId: options.environmentId,
    forMutation: options.forMutation ?? op.kind === 'mutation',
    sessionOnly: SESSION_ONLY_OPERATIONS.has(opName),
  });
  const data = await executeDashboardOperation<T>(op, {
    token,
    variables: typeof variables === 'function' ? variables(environmentId) : variables,
    environmentId,
  });
  return { data, environmentId, token, op };
}

/** Run one team-scoped operation end to end (no environment header). */
export async function runTeamScopedOperation<T>(
  opName: string,
  variables?: Variables,
): Promise<{ data: T; token: string; op: CatalogOperation }> {
  const token = await requireCommandToken();
  const op = getOperation(opName);
  const data = await executeDashboardOperation<T>(op, { token, variables });
  return { data, token, op };
}
