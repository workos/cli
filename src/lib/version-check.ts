import { lt, valid } from 'semver';
import { yellow, dim } from '../utils/logging.js';
import { getVersion } from './settings.js';

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/workos/latest';
const TIMEOUT_MS = 500;

let hasWarned = false;

interface NpmPackageInfo {
  version: string;
}

/**
 * Check npm registry for latest version and warn if outdated.
 * Runs asynchronously, fails silently on any error.
 * Safe to call without awaiting (fire-and-forget).
 */
export async function checkForUpdates(): Promise<void> {
  if (hasWarned) return;

  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) return;

    const data = (await response.json()) as NpmPackageInfo;
    const latestVersion = data.version;
    const currentVersion = getVersion();

    // Validate both versions are valid semver
    if (!valid(latestVersion) || !valid(currentVersion)) return;

    // Only warn if current < latest
    if (lt(currentVersion, latestVersion)) {
      hasWarned = true;
      yellow(`Update available: ${currentVersion} → ${latestVersion}`);
      dim(`Run: npx workos@latest`);
    }
  } catch {
    // Silently ignore all errors (timeout, network, parse, etc.)
  }
}

/**
 * Reset warning state (for testing).
 * @internal
 */
export function _resetWarningState(): void {
  hasWarned = false;
}
