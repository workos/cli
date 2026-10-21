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
 */

import { requireCommandToken } from './command-auth.js';
import { dashboardGraphqlRequest, dashboardGraphqlUpload, type DashboardUploadFile } from './dashboard-graphql.js';
import { resolveEnvironmentTarget } from './environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import type { CatalogOperation } from '../catalog/catalog-types.js';

type Variables = Record<string, unknown>;

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
  /** For follow-up requests within the same invocation. */
  token: string;
  op: CatalogOperation;
}

/**
 * Execute one operation with an already-resolved token/environment, translating
 * any transport/server failure into a structured exit.
 */
export async function executeDashboardOperation<T>(
  op: CatalogOperation,
  options: { token: string; variables?: Variables; environmentId?: string },
): Promise<T> {
  try {
    return await dashboardGraphqlRequest<T>(resolveExecutableDocument(op), options);
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
  options: { token: string; variables?: Variables; environmentId?: string; files: DashboardUploadFile[] },
): Promise<T> {
  try {
    return await dashboardGraphqlUpload<T>(resolveExecutableDocument(op), options);
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
  const token = await requireCommandToken();
  const op = getOperation(opName);
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: options.forMutation ?? op.kind === 'mutation',
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
