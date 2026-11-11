/**
 * API-key execution for environment-scoped resource commands.
 *
 * `executeDashboardOperation()` routes here when the invocation runs with an
 * API key (see `resource-auth.ts`). Each catalog operation that has a WorkOS
 * REST equivalent has an adapter that returns the dashboard operation's data
 * shape, so command handlers and their `--json` shapers don't change. An
 * operation with no REST equivalent exits with a structured
 * `api_key_unsupported` error naming what's missing; nothing is faked.
 *
 * User-facing copy here follows the no-internal-terms rule enforced by
 * `no-graphql-leak.spec.ts`.
 */

import type { ApiKeyAuth } from '../resource-auth.js';
import { createApiErrorHandler } from '../api-error-handler.js';
import { CliExit } from '../../utils/cli-exit.js';
import { exitWithError } from '../../utils/output.js';
import { WorkOSApiError } from '../workos-api.js';
import {
  type ApiKeyContext,
  type ApiKeyOperation,
  type Variables,
  createContext,
  exitApiKeyUnsupported,
} from './context.js';
import { organizationOperations } from './organizations.js';
import { userOperations } from './users.js';
import { membershipOperations } from './memberships.js';
import { rbacOperations } from './rbac.js';
import { platformOperations } from './platform.js';
import { appConfigOperations } from './app-config.js';

const OPERATIONS: Record<string, ApiKeyOperation> = {
  ...organizationOperations,
  ...userOperations,
  ...membershipOperations,
  ...rbacOperations,
  ...platformOperations,
  ...appConfigOperations,
};

/**
 * Operations the WorkOS REST API can't serve, keyed by catalog operation name,
 * with what's missing in user-facing terms.
 */
export const API_KEY_UNSUPPORTED: Record<string, string> = {
  logoutUris: 'AuthKit sign-out redirect URIs have no WorkOS API endpoint',
  setLogoutUris: 'AuthKit sign-out redirect URIs have no WorkOS API endpoint',
  environmentAppBranding: 'AuthKit branding images have no WorkOS API endpoint',
  updateAppBranding: 'AuthKit branding images have no WorkOS API endpoint',
};

/** What's missing for an operation the API key can't run, in user-facing terms. */
export function apiKeyUnsupportedReason(opName: string): string {
  return API_KEY_UNSUPPORTED[opName] ?? 'this action has no WorkOS API endpoint';
}

const handleApiError = createApiErrorHandler('WorkOS API');

/**
 * Run one catalog operation against the REST API with an API key, returning
 * the dashboard operation's data shape. Exits with a structured error on any
 * failure; never returns on error.
 */
export async function executeApiKeyOperation<T>(
  opName: string,
  variables: Variables | undefined,
  auth: ApiKeyAuth,
): Promise<T> {
  const operation = OPERATIONS[opName];
  if (!operation) exitApiKeyUnsupported(apiKeyUnsupportedReason(opName));
  return withApiKey(auth, (ctx) => operation(variables ?? {}, ctx) as Promise<T>);
}

/**
 * Run REST calls with an API key under the same structured-error contract as
 * {@link executeApiKeyOperation}. For the few commands whose REST semantics
 * differ enough that they call REST directly (flag targets, homepage URL).
 */
export async function withApiKey<T>(auth: ApiKeyAuth, run: (ctx: ApiKeyContext) => Promise<T>): Promise<T> {
  try {
    return await run(createContext(auth));
  } catch (error) {
    // An adapter's own structured exit is already reported.
    if (error instanceof CliExit) throw error;
    // Adapters turn the 404s a command reports itself into its not-found
    // result; any other 404 keeps the API's own message ("Organization not
    // found: 'org_…'"), which names the missing thing.
    if (error instanceof WorkOSApiError && error.statusCode === 404) {
      exitWithError({
        code: 'not_found',
        message: error.message || 'Not found.',
        apiContext: { status: 404, code: error.code ?? 'not_found' },
      });
    }
    return handleApiError(error);
  }
}

export { exitApiKeyUnsupported, apiKeyUnsupportedMessage } from './context.js';
export { changeFlagTarget } from './platform.js';
export { setHomepageUrl } from './app-config.js';
