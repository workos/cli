/**
 * Startup auth guard - ensures valid authentication before command execution.
 */

import { getCredentials, updateTokens, isTokenExpired, clearCredentials } from './credentials.js';
import { refreshAccessToken } from './token-refresh-client.js';
import { getCliAuthClientId, getAuthkitDomain } from './settings.js';
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
 * Ensure valid authentication before command execution.
 *
 * - No credentials: triggers login flow
 * - Expired access token (valid refresh): silently refreshes
 * - Expired refresh token: triggers login flow
 *
 * @returns Result indicating what actions were taken
 * @throws Error if login fails or refresh fails unexpectedly
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

export async function ensureAuthenticated(): Promise<EnsureAuthResult> {
  const result: EnsureAuthResult = {
    authenticated: false,
    loginTriggered: false,
    tokenRefreshed: false,
  };

  await warnIfSandboxed();

  // Case 1: No credentials or invalid credentials
  const creds = getCredentials();
  if (!creds) {
    clearCredentials(); // Clean up any corrupt/empty files
    if (!isPromptAllowed()) {
      exitForAuthRequired();
    }
    logInfo('[ensure-auth] No valid credentials found, triggering login');
    await runLogin();
    result.loginTriggered = true;
    result.authenticated = getCredentials() !== null;
    return result;
  }

  // Case 2: Access token still valid
  if (!isTokenExpired(creds)) {
    result.authenticated = true;
    return result;
  }

  // Case 3: Access token expired, try refresh
  if (creds.refreshToken) {
    logInfo('[ensure-auth] Access token expired, attempting refresh');

    const clientId = getCliAuthClientId();
    const authkitDomain = getAuthkitDomain();

    if (clientId && authkitDomain) {
      const refreshResult = await refreshAccessToken(authkitDomain, clientId);

      if (refreshResult.success && refreshResult.accessToken && refreshResult.expiresAt) {
        updateTokens(refreshResult.accessToken, refreshResult.expiresAt, refreshResult.refreshToken);
        result.tokenRefreshed = true;
        result.authenticated = true;
        return result;
      }

      // Refresh failed - check if it's recoverable
      if (refreshResult.errorType === 'invalid_grant') {
        clearCredentials();
        if (!isPromptAllowed()) {
          exitForAuthRequired(
            isCiMode()
              ? 'Session expired. Refresh credentials before running in CI, or set WORKOS_API_KEY.'
              : `Session expired. Run \`${formatWorkOSCommand('auth login')}\` on the host shell or set WORKOS_API_KEY.`,
          );
        }
        logInfo('[ensure-auth] Refresh token expired, triggering login');
        await runLogin();
        result.loginTriggered = true;
        result.authenticated = getCredentials() !== null;
        return result;
      }

      // Network or server error - keep credentials intact for retry
      if (!isPromptAllowed()) {
        exitForAuthRequired(
          isCiMode()
            ? `Authentication refresh failed (${refreshResult.errorType}). Refresh credentials before running in CI, or set WORKOS_API_KEY.`
            : `Authentication refresh failed (${refreshResult.errorType}). Run \`${formatWorkOSCommand('auth login')}\` on the host shell or set WORKOS_API_KEY.`,
        );
      }
      logInfo(`[ensure-auth] Refresh failed (${refreshResult.errorType}), triggering login`);
      await runLogin();
      result.loginTriggered = true;
      result.authenticated = getCredentials() !== null;
      return result;
    }
  }

  // Case 4: No refresh token available — clear stale creds, must login
  clearCredentials();
  if (!isPromptAllowed()) {
    exitForAuthRequired(
      isCiMode()
        ? 'Session expired. Refresh credentials before running in CI, or set WORKOS_API_KEY.'
        : `Session expired. Run \`${formatWorkOSCommand('auth login')}\` on the host shell or set WORKOS_API_KEY.`,
    );
  }
  logInfo('[ensure-auth] No refresh token, triggering login');
  await runLogin();
  result.loginTriggered = true;
  result.authenticated = getCredentials() !== null;
  return result;
}
