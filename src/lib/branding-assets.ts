/**
 * Branding image assets: the flag → GraphQL field mapping, and local validation
 * that mirrors the server's upload limits.
 *
 * Validating here rather than letting the server reject is deliberate. The
 * upload middleware enforces its size cap by aborting the multipart stream, so
 * an oversized file surfaces as a truncated-request failure rather than a
 * message naming the limit. Checking first turns that into an actionable error
 * without spending the upload.
 *
 * These constants mirror the API and will drift if it changes; they are a UX
 * affordance, not the enforcement boundary (the server remains authoritative).
 */

import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { exitWithError } from '../utils/output.js';

/** Server cap per file (`MAX_FILE_SIZE_BYTES` in the upload middleware). */
export const MAX_BRANDING_ASSET_BYTES = 400 * 1024;

/** Extensions the server accepts, mapped to the content type to declare. */
export const BRANDING_ASSET_CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
};

/**
 * The six branding images, each as a CLI option paired with the
 * `UpdateAppBrandingInput` field it fills.
 *
 * Naming note: the API calls the app icon a "logo icon"
 * (`lightLogoIconFile`), which reads as a variant of the logo rather than the
 * separate asset it is. The CLI exposes it as `--icon`.
 */
export interface BrandingAssetSpec {
  /** camelCase option key as yargs parses it. */
  option: string;
  /** Field on `UpdateAppBrandingInput`. */
  field: string;
  /** Human label for command output. */
  label: string;
}

export const BRANDING_ASSETS: readonly BrandingAssetSpec[] = [
  { option: 'logo', field: 'lightLogoFile', label: 'logo (light)' },
  { option: 'logoDark', field: 'darkLogoFile', label: 'logo (dark)' },
  { option: 'icon', field: 'lightLogoIconFile', label: 'icon (light)' },
  { option: 'iconDark', field: 'darkLogoIconFile', label: 'icon (dark)' },
  { option: 'favicon', field: 'lightFaviconFile', label: 'favicon (light)' },
  { option: 'faviconDark', field: 'darkFaviconFile', label: 'favicon (dark)' },
];

export interface LoadedBrandingAsset {
  spec: BrandingAssetSpec;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
  /** Source path, for output. */
  path: string;
}

/**
 * Resolve a file's content type from its extension.
 *
 * Extension-based rather than magic-byte sniffing: the server validates the
 * declared mimetype against its own allowlist and separately sanitizes SVG, so
 * this only needs to name the type correctly for well-formed input. A wrong
 * extension on real image bytes is rejected server-side, not silently accepted.
 */
export function contentTypeForAsset(filePath: string): string | undefined {
  return BRANDING_ASSET_CONTENT_TYPES[extname(filePath).toLowerCase()];
}

/**
 * Read and validate one branding asset, exiting with a structured error when
 * the file is missing, unreadable, an unsupported type, or over the size cap.
 */
export async function loadBrandingAsset(spec: BrandingAssetSpec, filePath: string): Promise<LoadedBrandingAsset> {
  const contentType = contentTypeForAsset(filePath);
  if (!contentType) {
    const supported = Object.keys(BRANDING_ASSET_CONTENT_TYPES).join(', ');
    exitWithError({
      code: 'unsupported_image_type',
      message: `"${filePath}" is not a supported image type. Supported extensions: ${supported}.`,
    });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    exitWithError({ code: 'file_not_found', message: `Could not read "${filePath}".` });
  }

  if (bytes.byteLength === 0) {
    exitWithError({ code: 'invalid_image', message: `"${filePath}" is empty.` });
  }

  if (bytes.byteLength > MAX_BRANDING_ASSET_BYTES) {
    exitWithError({
      code: 'image_too_large',
      message:
        `"${filePath}" is ${formatBytes(bytes.byteLength)}, over the ` +
        `${formatBytes(MAX_BRANDING_ASSET_BYTES)} limit for branding images.`,
    });
  }

  return { spec, filename: basename(filePath), contentType, bytes, path: filePath };
}

/**
 * Size for human messages: KB with one decimal, which suits a 400 KB cap.
 *
 * Rounds UP, so a size is never reported as smaller than it is. Rounding to
 * nearest would render 400 KB + 1 byte as "400.0 KB", making the over-limit
 * error read as though the file were exactly at the limit.
 */
export function formatBytes(bytes: number): string {
  return `${(Math.ceil((bytes / 1024) * 10) / 10).toFixed(1)} KB`;
}
