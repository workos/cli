/**
 * `workos config` — additive AuthKit app-config conveniences on the dashboard
 * account plane.
 *
 * Migrated from the API-key REST plane (graphql-resource-migration Phase 7):
 * the subcommand surface (redirect add / cors add / homepage-url set) is
 * unchanged, but every operation now runs catalog-backed dashboard operations
 * with the user's OAuth bearer. Output shapes are new curated shapes (approved
 * breaking change); the authoritative examples live in `config.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - The REST redirect/CORS endpoints were additive; the dashboard plane only
 *   has full-list setters. `redirect add` / `cors add` are therefore
 *   READ-MERGE-WRITE: fetch the current list, no-op if the value is already
 *   present, otherwise append and set the whole list. A concurrent editor's
 *   change between the read and the write is lost — an accepted race window,
 *   noted in help text (the same trade-off `authkit redirect-uris set` makes).
 * - The redirect merge read is one bounded page: if more URIs exist than the
 *   scan cap, the command errors loudly rather than silently dropping the
 *   overflow from the rewritten list.
 * - `homepage-url set` resolves the environment's AuthKit application, then
 *   updates its homepage URL — the same application the REST endpoint
 *   dual-wrote.
 *
 * `config` and `authkit` intentionally both survive with overlapping
 * capability (consolidation is deferred by decision).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation } from '../catalog/operation.js';
import { executeDashboardOperation } from '../lib/dashboard-operation.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { rejectWildcardOrigins } from './authkit.js';

/**
 * `redirect add` merges over one page of existing URIs — a single bounded
 * request, never an unbounded fan-out. More than this and the merge would
 * silently drop the overflow, so the command refuses instead.
 */
export const REDIRECT_MERGE_SCAN_LIMIT = 100;

interface UriNode {
  id?: string | null;
  uri: string;
  isDefault?: boolean | null;
}

export interface ConfigRedirectAddOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runConfigRedirectAdd(uri: string, options: ConfigRedirectAddOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const readOp = getOperation('redirectUris');
  const writeOp = getOperation('setRedirectUris');

  // The subcommand as a whole mutates: pre-validate the resolved target.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: writeOp.kind === 'mutation',
  });

  // READ: the current full list (the backing setter replaces the whole list).
  const current = await executeDashboardOperation<{
    redirectUris: {
      data: UriNode[];
      listMetadata?: { before?: string | null; after?: string | null } | null;
    } | null;
  }>(readOp, { token, variables: { environmentId, limit: REDIRECT_MERGE_SCAN_LIMIT }, environmentId });

  const existing = current.redirectUris?.data ?? [];
  // Refuse to merge over a truncated read: rewriting the list from one page
  // would silently drop every URI beyond the cap.
  if (current.redirectUris?.listMetadata?.after) {
    exitWithError({
      code: 'too_many_uris',
      message: `This environment has more than ${REDIRECT_MERGE_SCAN_LIMIT} redirect URIs; adding one here could drop the rest. Use \`authkit redirect-uris set\` with the full list instead.`,
    });
  }

  if (existing.some((node) => node.uri === uri)) {
    if (isJsonMode()) {
      outputJson({ uri, alreadyExists: true });
    } else {
      console.log(chalk.yellow('Redirect URI already exists (no change)'));
    }
    return;
  }

  // MERGE-WRITE: existing entries keep their id/isDefault; the new URI rides
  // along without a default marker.
  const merged = [
    ...existing.map((node) => ({
      ...(node.id != null ? { id: node.id } : {}),
      uri: node.uri,
      ...(node.isDefault != null ? { isDefault: node.isDefault } : {}),
    })),
    { uri },
  ];

  const data = await executeDashboardOperation<{
    setRedirectUris:
      | { __typename: 'RedirectUrisSet'; redirectUris: UriNode[] }
      | { __typename: string; message?: string; uri?: string };
  }>(writeOp, { token, variables: { input: { environmentId, redirectUris: merged } }, environmentId });

  const result = data.setRedirectUris;
  if (result.__typename !== 'RedirectUrisSet' || !('redirectUris' in result)) {
    const detail =
      'message' in result && result.message
        ? `${result.message}${result.uri ? ` (${result.uri})` : ''}`
        : 'Invalid redirect URI.';
    exitWithError({ code: 'invalid_redirect_uri', message: detail });
  }

  if (isJsonMode()) {
    outputJson({ uri, alreadyExists: false });
    return;
  }
  outputSuccess(`Added redirect URI ${chalk.bold(uri)}`);
}

export interface ConfigCorsAddOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runConfigCorsAdd(origin: string, options: ConfigCorsAddOptions = {}): Promise<void> {
  rejectWildcardOrigins([origin]);
  const token = await requireCommandToken();
  const readOp = getOperation('corsConfig');
  const writeOp = getOperation('updateCorsConfig');

  // The subcommand as a whole mutates: pre-validate the resolved target.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: writeOp.kind === 'mutation',
  });

  // READ: the current full list (the backing setter replaces the whole list;
  // origins are unpaginated).
  const current = await executeDashboardOperation<{
    webOrigins: { webOrigins: { origins: string[] } | null } | null;
  }>(readOp, { token, variables: { environmentId }, environmentId });

  const existing = current.webOrigins?.webOrigins?.origins ?? [];
  if (existing.includes(origin)) {
    if (isJsonMode()) {
      outputJson({ origin, alreadyExists: true });
    } else {
      console.log(chalk.yellow('CORS origin already exists (no change)'));
    }
    return;
  }

  // MERGE-WRITE: append and set the whole list.
  const data = await executeDashboardOperation<{
    setWebOrigins:
      | { __typename: 'WebOriginsSet'; origins: string[] }
      | { __typename: string; message?: string; uri?: string };
  }>(writeOp, { token, variables: { environmentId, origins: [...existing, origin] }, environmentId });

  const result = data.setWebOrigins;
  if (result.__typename !== 'WebOriginsSet' || !('origins' in result)) {
    const detail =
      'message' in result && result.message
        ? `${result.message}${result.uri ? ` (${result.uri})` : ''}`
        : 'Invalid web origin.';
    exitWithError({ code: 'invalid_web_origin', message: detail });
  }

  if (isJsonMode()) {
    outputJson({ origin, alreadyExists: false });
    return;
  }
  outputSuccess(`Added CORS origin ${chalk.bold(origin)}`);
}

export interface ConfigHomepageUrlSetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runConfigHomepageUrlSet(url: string, options: ConfigHomepageUrlSetOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const lookupOp = getOperation('defaultAuthkitApplication');
  const writeOp = getOperation('updateAuthkitApplication');

  // The subcommand as a whole mutates: pre-validate the resolved target.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: writeOp.kind === 'mutation',
  });

  // Step 1: resolve the environment's AuthKit application — the update is
  // keyed by application ID, and this is the application the REST endpoint
  // wrote to.
  const lookup = await executeDashboardOperation<{ defaultUserlandApplication: { id: string } | null }>(lookupOp, {
    token,
    variables: { environmentId },
    environmentId,
  });

  const applicationId = lookup.defaultUserlandApplication?.id;
  if (!applicationId) {
    exitWithError({
      code: 'not_found',
      message: 'No AuthKit application was found for this environment.',
    });
  }

  // Step 2: set the homepage URL on it. The result is a discriminated union
  // whose variant names are internal — matched on, never echoed.
  const data = await executeDashboardOperation<{
    updateUserlandApplication:
      | {
          __typename: 'UserlandApplicationUpdated';
          userlandApplication: { id: string; appHomepageUrl?: string | null };
        }
      | { __typename: 'UserlandApplicationNotFound'; applicationId: string }
      | { __typename: 'UserlandApplicationValidationFailed'; message: string };
  }>(writeOp, { token, variables: { input: { applicationId, appHomepageUrl: url } }, environmentId });

  const result = data.updateUserlandApplication;
  if (result.__typename === 'UserlandApplicationNotFound') {
    exitWithError({
      code: 'not_found',
      message: 'The AuthKit application for this environment could not be found.',
    });
  }
  if (result.__typename === 'UserlandApplicationValidationFailed') {
    exitWithError({
      code: 'invalid_argument',
      message: result.message || `Could not set the homepage URL to "${url}".`,
    });
  }
  if (result.__typename !== 'UserlandApplicationUpdated') {
    exitWithError({ code: 'unexpected_result', message: `Could not set the homepage URL to "${url}".` });
  }

  if (isJsonMode()) {
    outputJson({ homepageUrl: url, applicationId });
    return;
  }
  outputSuccess(`Set homepage URL to ${chalk.bold(url)}`);
}
