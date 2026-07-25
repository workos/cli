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
import { executeDashboardUpload, runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { getOperation } from '../catalog/operation.js';
import { BRANDING_ASSETS, formatBytes, loadBrandingAsset, type LoadedBrandingAsset } from '../lib/branding-assets.js';
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
  // Environment-scoped: resolved target as variable + header.
  const { data } = await runEnvScopedOperation<{
    environment: { appBranding: AppBranding | null } | null;
  }>('environmentAppBranding', options, (environmentId) => ({ environmentId }));

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

export interface BrandingSetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** One path per asset flag; every one is optional, but at least one is required. */
  logo?: string;
  logoDark?: string;
  icon?: string;
  iconDark?: string;
  favicon?: string;
  faviconDark?: string;
}

type UpdateBrandingResult = {
  updateAppBranding:
    | { __typename: 'AppBrandingUpdated'; appBranding: AppBranding }
    | { __typename: 'AppBrandingUploadAssetsError'; errorMessage: string }
    | { __typename: string };
};

/**
 * Upload branding images (logo, icon, favicon — light and dark) for an
 * environment.
 *
 * This is the one command that cannot go through the ordinary JSON request
 * path: the branding image fields are `Upload` scalars, which only exist over
 * the GraphQL multipart transport. Everything else (auth, environment
 * targeting, error translation) is the standard dashboard-plane preamble.
 *
 * Scope: we address the environment's own branding record by `id` and do NOT
 * send `environmentId`. The server decides how far the write reaches — with
 * per-environment branding on, only this environment's record changes; with it
 * off, the API mirrors the write across the project's records to preserve the
 * legacy shared-branding behavior. Passing `environmentId` would instead force
 * the environment-scoped path, which is invisible to AuthKit whenever
 * per-environment branding is off. Letting the server choose is correct under
 * both, and matches what the dashboard's own editor does.
 */
export async function runAuthkitBrandingSet(options: BrandingSetOptions): Promise<void> {
  const requested = BRANDING_ASSETS.map((spec) => ({
    spec,
    path: options[spec.option as keyof BrandingSetOptions] as string | undefined,
  })).filter((entry): entry is { spec: (typeof BRANDING_ASSETS)[number]; path: string } => Boolean(entry.path));

  if (requested.length === 0) {
    const flags = BRANDING_ASSETS.map((spec) => `--${toFlag(spec.option)}`).join(', ');
    exitWithError({
      code: 'missing_argument',
      message: `Provide at least one image to upload (${flags}).`,
    });
  }

  // Read and validate every file BEFORE resolving auth or touching the network,
  // so a bad path fails instantly and without a partial upload.
  const assets: LoadedBrandingAsset[] = [];
  for (const { spec, path } of requested) {
    assets.push(await loadBrandingAsset(spec, path));
  }

  // Read the environment's branding to address the record we update. Marked as
  // a mutation so the environment is pre-validated once for both requests.
  const { data, token, environmentId } = await runEnvScopedOperation<{
    environment: { appBranding: AppBranding | null } | null;
  }>('environmentAppBranding', { ...options, forMutation: true }, (env) => ({ environmentId: env }));

  const brandingId = data.environment?.appBranding?.id ?? null;

  // Every environment normally has a branding record. When one does not exist
  // yet the record cannot be addressed by id, so fall back to naming the
  // environment and let the API create it (the same fallback the dashboard
  // editor uses).
  const input: Record<string, unknown> = brandingId ? { id: brandingId } : { id: '', environmentId };
  for (const asset of assets) {
    input[asset.spec.field] = null; // multipart placeholder; the file part fills it
  }

  const result = await executeDashboardUpload<UpdateBrandingResult>(getOperation('updateAppBranding'), {
    token,
    environmentId,
    variables: { input },
    files: assets.map((asset) => ({
      variablePath: `variables.input.${asset.spec.field}`,
      filename: asset.filename,
      contentType: asset.contentType,
      bytes: asset.bytes,
    })),
  });

  const updated = result.updateAppBranding;
  if (updated.__typename === 'AppBrandingUploadAssetsError') {
    exitWithError({
      code: 'branding_upload_failed',
      message: (updated as { errorMessage: string }).errorMessage,
    });
  }
  if (updated.__typename !== 'AppBrandingUpdated') {
    exitWithError({
      code: 'branding_not_found',
      message: 'No branding configuration was found for this environment.',
    });
  }

  const branding = (updated as { appBranding: AppBranding }).appBranding;
  const uploaded = assets.map((asset) => ({
    asset: asset.spec.label,
    file: asset.path,
    bytes: asset.bytes.byteLength,
  }));

  if (isJsonMode()) {
    outputJson({ branding, uploaded });
    return;
  }
  outputSuccess(`Uploaded ${uploaded.length} branding image${uploaded.length === 1 ? '' : 's'}`);
  for (const asset of assets) {
    console.log(chalk.dim(`  • ${asset.spec.label}: ${asset.path} (${formatBytes(asset.bytes.byteLength)})`));
  }
}

/** camelCase option key → kebab-case CLI flag (`logoDark` → `logo-dark`). */
function toFlag(option: string): string {
  return option.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}
