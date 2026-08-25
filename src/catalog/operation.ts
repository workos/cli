import { loadManagementCatalog } from './loader.js';
import { DashboardGraphqlError } from '../lib/dashboard-graphql.js';
import { DASHBOARD_ERROR_MESSAGES } from '../lib/command-auth.js';
import { exitWithError } from '../utils/output.js';
import type { CatalogOperation, ManagementCatalog } from './catalog-types.js';

/**
 * Catalog-operation accessors for command handlers.
 *
 * Category command handlers (Phase 3+) never import the snapshot or hand-write
 * GraphQL: they look an operation up by name and ask for its executable document.
 * The GraphQL `document` text stays internal to this layer — handlers pass the
 * returned string straight to `dashboardGraphqlRequest()` and otherwise treat it
 * as opaque (the no-graphql-leak contract is about user-facing strings, not the
 * wire document).
 *
 * Environment targeting contract: each call site classifies itself explicitly.
 * Environment-scoped operations resolve their target through
 * `resolveEnvironmentTarget()` (src/lib/environment-target.ts) and thread the
 * resolved ID into `dashboardGraphqlRequest({ environmentId })`; the operation's
 * resolver validates the ID against the caller's current team before every
 * environment-scoped request. Team-scoped operations deliberately pass no
 * `environmentId`. Never bypass the resolver: a missing or unknown header
 * silently targets the team's production environment.
 */

// Name → operation indexes, one per catalog instance (loadManagementCatalog
// memoizes the snapshot, so the default path builds this exactly once).
const operationIndexes = new WeakMap<ManagementCatalog, Map<string, CatalogOperation>>();

function operationIndex(catalog: ManagementCatalog): Map<string, CatalogOperation> {
  let index = operationIndexes.get(catalog);
  if (!index) {
    index = new Map(catalog.operations.map((op) => [op.name, op]));
    operationIndexes.set(catalog, index);
  }
  return index;
}

/**
 * Look up a catalog operation by its name (the `mapsTo` value in the manifest).
 *
 * Includes feature-flag-gated operations so a handler can still resolve an op
 * that the live MCP would hide — the CLI guards those at the command layer (via
 * the manifest + clear errors), not by making them un-loadable here. Throws if
 * the name is absent, which only happens on a manifest/catalog drift that
 * `justification:check` would already have failed on.
 */
export function getOperation(
  name: string,
  catalog: ManagementCatalog = loadManagementCatalog(undefined, { includeFeatureFlagged: true }),
): CatalogOperation {
  const op = operationIndex(catalog).get(name);
  if (!op) {
    throw new Error(
      `Catalog operation "${name}" not found. The vendored snapshot may be stale; run \`pnpm catalog:vendor\`.`,
    );
  }
  return op;
}

/**
 * Returns the full executable GraphQL document for an operation: its own
 * `document` text plus the definitions of every fragment it transitively
 * depends on.
 *
 * The catalog stores operation text WITHOUT its fragments (they are deduped into
 * `catalog.fragments`), so sending `op.document` alone would fail with "Unknown
 * fragment" whenever `op.fragmentNames` is non-empty. This stitches them back
 * together so the document is valid on the wire. The result is internal — never
 * surface it to users.
 */
export function resolveExecutableDocument(
  op: CatalogOperation,
  catalog: ManagementCatalog = loadManagementCatalog(undefined, { includeFeatureFlagged: true }),
): string {
  if (op.fragmentNames.length === 0) return op.document;

  const fragments = op.fragmentNames.map((fragmentName) => {
    const fragment = catalog.fragments[fragmentName];
    if (!fragment) {
      throw new Error(
        `Fragment "${fragmentName}" required by operation "${op.name}" is missing from the catalog snapshot.`,
      );
    }
    return fragment;
  });

  return [op.document, ...fragments].join('\n\n');
}

/**
 * Translate a {@link DashboardGraphqlError} into a clean exit, using the
 * shared dashboard-plane error taxonomy (forbidden / http_error /
 * graphql_error / network_error).
 *
 * The dashboard OAuth-bearer capability the account-plane commands rely on is
 * enabled in production but gated by a per-team feature flag (fail-closed), so
 * a 403 remains an expected outcome: the flag is off for the caller's team, or
 * the account isn't team-backed. We surface that distinctly — and without ever
 * naming GraphQL — so the failure is actionable rather than a generic 403.
 * Never returns.
 */
export function reportDashboardError(error: unknown): never {
  if (error instanceof DashboardGraphqlError) {
    // Build a clean, user-facing message per code. We deliberately do NOT echo
    // `error.message`: the underlying client phrases every failure in terms of
    // "the dashboard GraphQL API", and GraphQL must never surface to users.
    exitWithError({ code: error.code, message: dashboardErrorMessage(error) });
  }
  throw error;
}

/**
 * Per-code user-facing copy. Exported so `no-graphql-leak.spec.ts` can run the
 * leak gate over every branch. `forbidden` (exit 1, not auth-recoverable) is
 * shared copy from {@link DASHBOARD_ERROR_MESSAGES}, distinct from the
 * `auth_required` (exit 4) messages that `requireCommandToken()` owns.
 */
export function dashboardErrorMessage(error: DashboardGraphqlError): string {
  switch (error.code) {
    case 'forbidden':
      return DASHBOARD_ERROR_MESSAGES.forbidden;
    case 'http_error':
      return `The WorkOS account plane returned an unexpected response${error.status ? ` (HTTP ${error.status})` : ''}.`;
    case 'network_error':
      return 'Could not reach the WorkOS account plane. Check your connection and try again.';
    case 'graphql_error':
    default:
      return 'The WorkOS account plane could not complete this request.';
  }
}
