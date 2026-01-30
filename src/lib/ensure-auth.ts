/**
 * Startup auth guard - ensures valid authentication before command execution.
 */

import { getCredentials, updateTokens, hasCredentials, isTokenExpired } from './credentials.js';
import { refreshAccessToken } from './token-refresh-client.js';
import { getCliAuthClientId, getAuthkitDomain } from './settings.js';
import { runLogin } from '../commands/login.js';
import { logInfo } from '../utils/debug.js';

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
export async function ensureAuthenticated(): Promise<EnsureAuthResult> {
  const result: EnsureAuthResult = {
    authenticated: false,
    loginTriggered: false,
    tokenRefreshed: false,
  };

  // Case 1: No credentials at all
  if (!hasCredentials()) {
    logInfo('[ensure-auth] No credentials found, triggering login');
    await runLogin();
    result.loginTriggered = true;
    result.authenticated = hasCredentials();
    return result;
  }

  const creds = getCredentials();
  if (!creds) {
    // Credentials file exists but is invalid/empty
    logInfo('[ensure-auth] Invalid credentials file, triggering login');
    await runLogin();
    result.loginTriggered = true;
    result.authenticated = hasCredentials();
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
        logInfo('[ensure-auth] Refresh token expired, triggering login');
        await runLogin();
        result.loginTriggered = true;
        result.authenticated = hasCredentials();
        return result;
      }

      // Network or server error - try login as fallback
      logInfo(`[ensure-auth] Refresh failed (${refreshResult.errorType}), triggering login`);
      await runLogin();
      result.loginTriggered = true;
      result.authenticated = hasCredentials();
      return result;
    }
  }

  // Case 4: No refresh token available, must login
  logInfo('[ensure-auth] No refresh token, triggering login');
  await runLogin();
  result.loginTriggered = true;
  result.authenticated = hasCredentials();
  return result;
}
