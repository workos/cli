import { lt, valid } from 'semver';
import { yellow, dim } from '../utils/logging.js';
import { getVersion } from './settings.js';
import { upgradeNotice } from './install-method.js';

// The web endpoint redirects to …/releases/tag/v{version} and, unlike
// api.github.com, is not subject to the anonymous 60-requests/hour/IP rate
// limit — users behind shared corporate NATs would otherwise silently stop
// seeing update notices.
const LATEST_RELEASE_URL = 'https://github.com/workos/cli/releases/latest';
const TIMEOUT_MS = 500;

let hasWarned = false;

/**
 * Check GitHub Releases for the latest binary version and warn if outdated.
 * Runs asynchronously, fails silently on any error.
 * Safe to call without awaiting (fire-and-forget).
 */
export async function checkForUpdates(): Promise<void> {
  if (hasWarned) return;

  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      method: 'HEAD',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    // Expect a redirect to …/releases/tag/v{version}; anything else means no
    // published release (or GitHub changed shape) — stay quiet.
    const location = response.headers.get('location') ?? '';
    const match = /\/releases\/tag\/v?([^/?#]+)/.exec(location);
    if (!match) return;

    const latestVersion = decodeURIComponent(match[1]);
    const currentVersion = getVersion();

    // Validate both versions are valid semver
    if (!valid(latestVersion) || !valid(currentVersion)) return;

    // Only warn if current < latest
    if (lt(currentVersion, latestVersion)) {
      hasWarned = true;
      yellow(`Update available: ${currentVersion} → ${latestVersion}`);
      dim(upgradeNotice());
      console.log();
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
