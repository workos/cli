/**
 * Startup auth guard - ensures valid authentication before command execution.
 *
 * Install-flow policy only: the expiry-check/refresh core lives in
 * `command-auth.ts` (`refreshIfExpired`), shared with the resource-command
 * guard `requireCommandToken()`. This wrapper owns what install flows do when
 * no usable session exists: trigger the login flow (or exit 4 when prompting
 * isn't allowed).
 */

import { getCredentials, hasCredentials } from './credentials.js';
import { refreshIfExpired } from './command-auth.js';
import { runLogin } from '../commands/login.js';
import { logInfo } from '../utils/debug.js';
import { isAgentMode, isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import { exitWithAuthRequired } from '../utils/exit-codes.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { warnIfSandboxed } from './host-probe.js';

export interface EnsureAuthResult {
  /** Whether auth is now valid */
  authenticated: boolean;
  /** Whether login flow was triggered */
  loginTriggered: boolean;
  /** Whether token was refreshed */
  tokenRefreshed: boolean;
}

/**
 * NOTE: the "set WORKOS_API_KEY" hints below stay: `ensureAuthenticated()` is
 * consumed only by install flows (via `resolveInstallCredentials`), which
 * honor WORKOS_API_KEY through an env-var early return. The
 * API-keys-don't-work-here copy applies only to dashboard-plane resource
 * commands and lives in `command-auth.ts`.
 */
function exitForAuthRequired(message?: string): never {
  if (isCiMode()) {
    exitWithAuthRequired(
      message ?? 'Not authenticated. Set WORKOS_API_KEY or configure credentials before running in CI.',
    );
  }

  if (isAgentMode()) {
    exitWithAuthRequired(
      message ??
        `Not authenticated. Run \`${formatWorkOSCommand('auth login')}\` on the host shell or set WORKOS_API_KEY.`,
    );
  }

  exitWithAuthRequired(message);
}

/**
 * Ensure valid authentication before command execution.
 *
 * - No credentials: triggers login flow
 * - Expired access token (valid refresh): silently refreshes
 * - Expired refresh token: triggers login flow
 *
 * @returns Result indicating what actions were taken
 * @throws Error if login fails or refresh fails unexpectedly
 */
export async function ensureAuthenticated(): Promise<EnsureAuthResult> {
  const result: EnsureAuthResult = {
    authenticated: false,
    loginTriggered: false,
    tokenRefreshed: false,
  };

  await warnIfSandboxed();

  // Snapshot before the refresh core runs: afterwards, store state alone
  // cannot distinguish "never logged in" from "session died and was cleared".
  const hadCredentials = getCredentials() !== null;

  const session = await refreshIfExpired();
  if (session) {
    result.authenticated = true;
    result.tokenRefreshed = session.refreshed;
    return result;
  }

  // No usable session. Derive the case from observable store state — the
  // shared core keeps credentials only on transient refresh failures.
  if (!hadCredentials) {
    // Never logged in (corrupt credential files were already cleaned up).
    if (!isPromptAllowed()) {
      exitForAuthRequired();
    }
    logInfo('[ensure-auth] No valid credentials found, triggering login');
  } else if (hasCredentials()) {
    // Credentials survived the attempt: transient refresh failure.
    if (!isPromptAllowed()) {
      exitForAuthRequired(
        isCiMode()
          ? 'Authentication refresh failed. Refresh credentials before running in CI, or set WORKOS_API_KEY.'
          : `Authentication refresh failed. Run \`${formatWorkOSCommand('auth login')}\` on the host shell or set WORKOS_API_KEY.`,
      );
    }
    logInfo('[ensure-auth] Refresh failed, triggering login');
  } else {
    // Credentials were cleared: the session is dead (expired refresh token,
    // no refresh token, or no client config to refresh with).
    if (!isPromptAllowed()) {
      exitForAuthRequired(
        isCiMode()
          ? 'Session expired. Refresh credentials before running in CI, or set WORKOS_API_KEY.'
          : `Session expired. Run \`${formatWorkOSCommand('auth login')}\` on the host shell or set WORKOS_API_KEY.`,
      );
    }
    logInfo('[ensure-auth] Session expired, triggering login');
  }

  await runLogin();
  result.loginTriggered = true;
  result.authenticated = getCredentials() !== null;
  return result;
}
