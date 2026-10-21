/**
 * `workos authkit` — per-environment AuthKit app configuration.
 *
 * The AuthKit setup surface a developer (or an agent/CI script) configures when
 * wiring auth: redirect URIs, CORS web origins, and logout URIs. These
 * run on the dashboard account plane with the user's OAuth bearer — the same
 * gated capability `whoami` / `environment` / `team` use. Distinct from
 * `workos config`, which runs on the same plane but ADDS individual
 * redirect/CORS entries; here the writes are full-list *set* operations and
 * expose a native `--dry-run` validation, so none are destructive.
 *
 * Selection note: the redirect/logout setters map to the environment-level ops
 * (`setRedirectUris`/`setLogoutUris`), not the application-level
 * `setAuthkitApplication*` ops whose input types carry internal `userland`
 * naming.
 *
 * Branding lives in `branding.ts` under its own top-level noun: the same record
 * drives transactional emails too, so it is not AuthKit-specific.
 */

import chalk from 'chalk';
import { runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

/** Guard a flag that must have at least one value. */
function requireAtLeastOne(values: string[] | undefined, flag: string): string[] {
  if (!values || values.length === 0) {
    exitWithError({ code: 'missing_argument', message: `At least one ${flag} is required.` });
  }
  return values;
}

/**
 * Reject wildcard web origins before they reach the server: an accepted
 * wildcard would allow every browser origin — equivalent to disabling CORS.
 * No legitimate origin contains `*`, so any occurrence is rejected.
 */
export function rejectWildcardOrigins(origins: string[]): void {
  const wildcard = origins.find((origin) => origin.includes('*'));
  if (wildcard !== undefined) {
    exitWithError({ code: 'invalid_web_origin', message: `Wildcard origins are not permitted: "${wildcard}".` });
  }
}

interface UriNode {
  id?: string | null;
  uri: string;
  isDefault?: boolean | null;
}

/** Map repeatable `--uri` (+ optional `--default`) onto the GraphQL input shape. */
function toUriInputs(uris: string[], defaultUri?: string): Array<{ uri: string; isDefault?: boolean }> {
  // A `--default` that matches none of the supplied URIs is almost always a typo;
  // fail loudly rather than silently persisting a list with no default.
  if (defaultUri !== undefined && !uris.includes(defaultUri)) {
    exitWithError({
      code: 'invalid_argument',
      message: `--default "${defaultUri}" must be one of the provided --uri values.`,
    });
  }
  return uris.map((uri) => (defaultUri === undefined ? { uri } : { uri, isDefault: uri === defaultUri }));
}

/** Render a list of redirect/logout URIs as a table (human) — JSON handled by caller. */
function renderUriTable(items: UriNode[]): void {
  if (items.length === 0) {
    console.log('No URIs configured.');
    return;
  }
  const rows = items.map((item) => [
    item.uri,
    item.isDefault ? chalk.green('yes') : chalk.dim('—'),
    item.id ?? chalk.dim('—'),
  ]);
  console.log(formatTable([{ header: 'URI' }, { header: 'Default' }, { header: 'ID' }], rows));
}

/** Summarize the outcome of a URI set, marking the default. */
function renderUriSetResult(items: UriNode[], noun: string, dryRun: boolean): void {
  const verb = dryRun ? 'Validated' : 'Set';
  const suffix = dryRun ? chalk.dim(' (dry run, not saved)') : '';
  outputSuccess(`${verb} ${items.length} ${noun}${items.length === 1 ? '' : 's'}${suffix}`);
  for (const item of items) {
    const marker = item.isDefault ? chalk.green(' (default)') : '';
    console.log(chalk.dim(`  • ${item.uri}${marker}`));
  }
}

// --- redirect URIs ---

export interface RedirectUrisListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  limit?: number;
}

export async function runAuthkitRedirectUrisList(options: RedirectUrisListOptions): Promise<void> {
  // Environment-scoped: the resolved target rides as both the operation
  // variable and the environment header.
  const { data } = await runEnvScopedOperation<{ redirectUris: { data: UriNode[] } | null }>(
    'redirectUris',
    options,
    (environmentId) => ({ environmentId, ...(options.limit !== undefined ? { limit: options.limit } : {}) }),
  );

  const uris = data.redirectUris?.data ?? [];
  if (isJsonMode()) {
    outputJson({ redirectUris: uris });
    return;
  }
  renderUriTable(uris);
}

export interface RedirectUrisSetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  uris: string[];
  default?: string;
  dryRun?: boolean;
}

export async function runAuthkitRedirectUrisSet(options: RedirectUrisSetOptions): Promise<void> {
  const uris = requireAtLeastOne(options.uris, '--uri');
  const dryRun = !!options.dryRun;

  // Environment-scoped mutation: pre-validated resolved target, sent as both
  // input field and environment header.
  const { data } = await runEnvScopedOperation<{
    setRedirectUris:
      | { __typename: 'RedirectUrisSet'; redirectUris: UriNode[] }
      | { __typename: 'InvalidRedirectUriError'; message: string; uri: string }
      | { __typename: 'InvalidWildcardRedirectUri'; message: string; uri: string };
  }>('setRedirectUris', options, (environmentId) => ({
    input: { environmentId, redirectUris: toUriInputs(uris, options.default), dryRun },
  }));

  const result = data.setRedirectUris;
  if (result.__typename !== 'RedirectUrisSet' || !('redirectUris' in result)) {
    const detail = 'message' in result ? `${result.message} (${result.uri})` : 'Invalid redirect URI.';
    exitWithError({ code: 'invalid_redirect_uri', message: detail });
  }

  const saved = result.redirectUris;
  if (isJsonMode()) {
    outputJson({ redirectUris: saved, dryRun });
    return;
  }
  renderUriSetResult(saved, 'redirect URI', dryRun);
}

// --- CORS ---

export interface CorsGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runAuthkitCorsGet(options: CorsGetOptions): Promise<void> {
  // Environment-scoped: resolved target as variable + header.
  const { data } = await runEnvScopedOperation<{
    webOrigins: { webOrigins: { origins: string[] } | null } | null;
  }>('corsConfig', options, (environmentId) => ({ environmentId }));

  const origins = data.webOrigins?.webOrigins?.origins ?? [];
  if (isJsonMode()) {
    outputJson({ origins });
    return;
  }
  if (origins.length === 0) {
    console.log('No web origins configured.');
    return;
  }
  for (const origin of origins) console.log(`  • ${origin}`);
}

export interface CorsSetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  origins: string[];
  dryRun?: boolean;
}

export async function runAuthkitCorsSet(options: CorsSetOptions): Promise<void> {
  const origins = requireAtLeastOne(options.origins, '--origin');
  rejectWildcardOrigins(origins);
  const dryRun = !!options.dryRun;

  // Environment-scoped mutation: pre-validated resolved target.
  const { data } = await runEnvScopedOperation<{
    setWebOrigins:
      | { __typename: 'WebOriginsSet'; origins: string[] }
      | { __typename: string; message?: string; uri?: string };
  }>('updateCorsConfig', options, (environmentId) => ({ environmentId, origins, dryRun }));

  const result = data.setWebOrigins;
  if (result.__typename !== 'WebOriginsSet' || !('origins' in result)) {
    const detail =
      'message' in result && result.message
        ? `${result.message}${result.uri ? ` (${result.uri})` : ''}`
        : 'Invalid web origin.';
    exitWithError({ code: 'invalid_web_origin', message: detail });
  }

  const saved = (result as { origins: string[] }).origins;
  if (isJsonMode()) {
    outputJson({ origins: saved, dryRun });
    return;
  }
  const verb = dryRun ? 'Validated' : 'Set';
  const suffix = dryRun ? chalk.dim(' (dry run, not saved)') : '';
  outputSuccess(`${verb} ${saved.length} web origin${saved.length === 1 ? '' : 's'}${suffix}`);
  for (const origin of saved) console.log(chalk.dim(`  • ${origin}`));
}

// --- logout URIs ---

export interface LogoutUrisListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  limit?: number;
}

export async function runAuthkitLogoutUrisList(options: LogoutUrisListOptions): Promise<void> {
  // Environment-scoped: resolved target as variable + header.
  const { data } = await runEnvScopedOperation<{ logoutUris: { data: UriNode[] } | null }>(
    'logoutUris',
    options,
    (environmentId) => ({ environmentId, ...(options.limit !== undefined ? { limit: options.limit } : {}) }),
  );

  const uris = data.logoutUris?.data ?? [];
  if (isJsonMode()) {
    outputJson({ logoutUris: uris });
    return;
  }
  renderUriTable(uris);
}

export interface LogoutUrisSetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  uris: string[];
  default?: string;
  dryRun?: boolean;
}

export async function runAuthkitLogoutUrisSet(options: LogoutUrisSetOptions): Promise<void> {
  const uris = requireAtLeastOne(options.uris, '--uri');
  const dryRun = !!options.dryRun;

  // Environment-scoped mutation: pre-validated resolved target.
  const { data } = await runEnvScopedOperation<{
    setLogoutUris:
      | { __typename: 'LogoutUrisSet'; logoutUris: UriNode[] }
      | { __typename: string; message?: string; uri?: string };
  }>('setLogoutUris', options, (environmentId) => ({
    input: { environmentId, logoutUris: toUriInputs(uris, options.default), dryRun },
  }));

  const result = data.setLogoutUris;
  if (result.__typename !== 'LogoutUrisSet' || !('logoutUris' in result)) {
    const detail =
      'message' in result && result.message
        ? `${result.message}${result.uri ? ` (${result.uri})` : ''}`
        : 'Invalid logout URI.';
    exitWithError({ code: 'invalid_logout_uri', message: detail });
  }

  const saved = (result as { logoutUris: UriNode[] }).logoutUris;
  if (isJsonMode()) {
    outputJson({ logoutUris: saved, dryRun });
    return;
  }
  renderUriSetResult(saved, 'logout URI', dryRun);
}
