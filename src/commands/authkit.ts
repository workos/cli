/**
 * `workos authkit` — per-environment AuthKit app configuration.
 *
 * The AuthKit setup surface a developer (or an agent/CI script) configures when
 * wiring auth: redirect URIs, CORS web origins, logout URIs, and branding. These
 * run on the dashboard account plane with the user's OAuth bearer — the same
 * gated capability `whoami` / `environment` / `team` use, distinct from the
 * API-key-based `workos config` command (which adds individual redirect/CORS
 * entries via the REST plane). Here the writes are full-list *set* operations and
 * expose a native `--dry-run` validation, so none are destructive.
 *
 * Selection note: the redirect/logout setters map to the environment-level ops
 * (`setRedirectUris`/`setLogoutUris`), not the application-level
 * `setAuthkitApplication*` ops whose input types carry internal `userland`
 * naming. Branding reads via `environmentAppBranding` (env-scoped, clean), not
 * `appBranding` (session-scoped with a rotten upstream description).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

/** Guard a flag that must have at least one value. */
function requireAtLeastOne(values: string[] | undefined, flag: string): string[] {
  if (!values || values.length === 0) {
    exitWithError({ code: 'missing_argument', message: `At least one ${flag} is required.` });
  }
  return values;
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
  const token = await requireCommandToken();
  const op = getOperation('redirectUris');

  // Environment-scoped: the resolved target rides as both the operation
  // variable and the environment header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: { redirectUris: { data: UriNode[] } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { environmentId, ...(options.limit !== undefined ? { limit: options.limit } : {}) },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

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
  const token = await requireCommandToken();
  const op = getOperation('setRedirectUris');

  // Environment-scoped mutation: pre-validated resolved target, sent as both
  // input field and environment header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    setRedirectUris:
      | { __typename: 'RedirectUrisSet'; redirectUris: UriNode[] }
      | { __typename: 'InvalidRedirectUriError'; message: string; uri: string }
      | { __typename: 'InvalidWildcardRedirectUri'; message: string; uri: string }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { environmentId, redirectUris: toUriInputs(uris, options.default), dryRun } },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.setRedirectUris;
  if (result.__typename !== 'RedirectUrisSet' || !('redirectUris' in result)) {
    const detail =
      'message' in result ? `${result.message} (${(result as { uri: string }).uri})` : 'Invalid redirect URI.';
    exitWithError({ code: 'invalid_redirect_uri', message: detail });
  }

  const saved = (result as { redirectUris: UriNode[] }).redirectUris;
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
  const token = await requireCommandToken();
  const op = getOperation('corsConfig');

  // Environment-scoped: resolved target as variable + header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: { webOrigins: { webOrigins: { origins: string[] } | null } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { environmentId },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

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
  const dryRun = !!options.dryRun;
  const token = await requireCommandToken();
  const op = getOperation('updateCorsConfig');

  // Environment-scoped mutation: pre-validated resolved target.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    setWebOrigins:
      | { __typename: 'WebOriginsSet'; origins: string[] }
      | { __typename: string; message?: string; uri?: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { environmentId, origins, dryRun },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

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
  const token = await requireCommandToken();
  const op = getOperation('logoutUris');

  // Environment-scoped: resolved target as variable + header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: { logoutUris: { data: UriNode[] } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { environmentId, ...(options.limit !== undefined ? { limit: options.limit } : {}) },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

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
  const token = await requireCommandToken();
  const op = getOperation('setLogoutUris');

  // Environment-scoped mutation: pre-validated resolved target.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    setLogoutUris:
      | { __typename: 'LogoutUrisSet'; logoutUris: UriNode[] }
      | { __typename: string; message?: string; uri?: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { environmentId, logoutUris: toUriInputs(uris, options.default), dryRun } },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

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

// --- branding ---

interface AppBranding {
  id?: string | null;
  displayName?: string | null;
  theme?: string | null;
  lightLogoPath?: string | null;
  darkLogoPath?: string | null;
  font?: { family?: string | null } | null;
  [key: string]: unknown;
}

export interface BrandingGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runAuthkitBrandingGet(options: BrandingGetOptions): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('environmentAppBranding');

  // Environment-scoped: resolved target as variable + header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: { environment: { appBranding: AppBranding | null } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { environmentId },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const branding = data.environment?.appBranding ?? null;
  if (isJsonMode()) {
    outputJson({ branding });
    return;
  }

  if (!branding) {
    console.log('No branding configured for this environment.');
    return;
  }
  // Human view shows a concise subset; the full object (custom CSS/HTML, all
  // colors, localized text) is available via --json.
  const fields: Array<[string, unknown]> = [
    ['Display name', branding.displayName],
    ['Theme', branding.theme],
    ['Font', branding.font?.family],
    ['Light logo', branding.lightLogoPath],
    ['Dark logo', branding.darkLogoPath],
  ];
  const shown = fields.filter(([, value]) => value !== null && value !== undefined && value !== '');
  if (shown.length === 0) {
    // Branding exists but only sets fields outside this summary (e.g. custom CSS).
    console.log('Branding is configured. Run with --json to view the full configuration.');
    return;
  }
  for (const [label, value] of shown) console.log(`${chalk.bold(label)}: ${String(value)}`);
  console.log(chalk.dim('Run with --json for the full branding configuration.'));
}
