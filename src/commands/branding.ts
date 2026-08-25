/**
 * `workos branding` — the logo, icon, and favicon an environment renders.
 *
 * Top-level rather than under `authkit` because branding is not AuthKit-only:
 * the same record drives hosted AuthKit pages and transactional emails.
 *
 * Runs on the dashboard account plane with the user's OAuth bearer, like
 * `whoami` / `environment` / `team`.
 */

import chalk from 'chalk';
import { executeDashboardUpload, runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { getOperation } from '../catalog/operation.js';
import {
  BRANDING_ASSETS,
  BRANDING_SLOTS,
  findBrandingAsset,
  formatBytes,
  loadBrandingAsset,
  type BrandingAssetSpec,
  type LoadedBrandingAsset,
} from '../lib/branding-assets.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';

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

export async function runBrandingGet(options: BrandingGetOptions): Promise<void> {
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
  /** Positional slot name (`icon`, `logo-dark`, …), paired with {@link file}. */
  slot?: string;
  /** Positional image path; only meaningful alongside {@link slot}. */
  file?: string;
  /** Flag form: one path per image, for setting several at once. */
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
 * Resolve the requested images from either accepted form.
 *
 * Positional (`branding set icon ./icon.png`) suits the common single-image
 * case; flags (`--icon ./i.png --logo ./l.png`) set several at once. Mixing
 * them is rejected rather than merged: the two forms could disagree about the
 * same slot, and silently picking a winner would upload the wrong file.
 */
function resolveRequestedAssets(options: BrandingSetOptions): Array<{ spec: BrandingAssetSpec; path: string }> {
  const fromFlags = BRANDING_ASSETS.map((spec) => ({
    spec,
    path: options[spec.option as keyof BrandingSetOptions] as string | undefined,
  })).filter((entry): entry is { spec: BrandingAssetSpec; path: string } => Boolean(entry.path));

  if (options.slot === undefined) {
    if (fromFlags.length === 0) {
      exitWithError({
        code: 'missing_argument',
        message:
          `Specify an image to upload: \`branding set <slot> <file>\` ` +
          `(slots: ${BRANDING_SLOTS.join(', ')}), or use the --<slot> flags to set several at once.`,
      });
    }
    return fromFlags;
  }

  if (fromFlags.length > 0) {
    exitWithError({
      code: 'invalid_argument',
      message: `Use either \`branding set ${options.slot} <file>\` or the --<slot> flags, not both.`,
    });
  }

  const spec = findBrandingAsset(options.slot);
  if (!spec) {
    exitWithError({
      code: 'invalid_argument',
      message: `Unknown image "${options.slot}". Valid slots: ${BRANDING_SLOTS.join(', ')}.`,
    });
  }

  if (!options.file) {
    exitWithError({
      code: 'missing_argument',
      message: `Specify the image file to upload: \`branding set ${options.slot} <file>\`.`,
    });
  }

  return [{ spec, path: options.file }];
}

/**
 * Upload branding images (logo, icon, favicon — light and dark).
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
export async function runBrandingSet(options: BrandingSetOptions): Promise<void> {
  const requested = resolveRequestedAssets(options);

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
