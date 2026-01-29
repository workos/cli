/**
 * Token refresh client for WorkOS OAuth
 */

import { logInfo, logError } from '../utils/debug.js';
import { getCredentials } from './credentials.js';

export interface RefreshResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  error?: string;
  errorType?: 'invalid_grant' | 'network' | 'server' | 'unknown';
}

interface TokenRefreshResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
}

interface TokenErrorResponse {
  error: string;
  error_description?: string;
}

const REFRESH_TIMEOUT_MS = 30_000;

/**
 * Refresh access token using stored refresh token.
 *
 * @param authkitDomain - The AuthKit domain (e.g., https://auth.workos.com)
 * @param clientId - OAuth client ID
 * @returns RefreshResult with new tokens or error details
 */
export async function refreshAccessToken(authkitDomain: string, clientId: string): Promise<RefreshResult> {
  const creds = getCredentials();

  if (!creds?.refreshToken) {
    return {
      success: false,
      error: 'No refresh token available',
      errorType: 'invalid_grant',
    };
  }

  const tokenUrl = `${authkitDomain}/oauth2/token`;
  logInfo('[token-refresh] Attempting token refresh');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: creds.refreshToken,
        client_id: clientId,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorData = (await response.json()) as TokenErrorResponse;
      logError('[token-refresh] Refresh failed:', errorData.error);

      if (errorData.error === 'invalid_grant') {
        return {
          success: false,
          error: 'Session expired. Run `wizard login` to re-authenticate.',
          errorType: 'invalid_grant',
        };
      }

      return {
        success: false,
        error: errorData.error_description || errorData.error,
        errorType: 'server',
      };
    }

    const data = (await response.json()) as TokenRefreshResponse;
    const expiresAt = Date.now() + data.expires_in * 1000;

    logInfo('[token-refresh] Token refreshed successfully, expires:', new Date(expiresAt).toISOString());

    return {
      success: true,
      accessToken: data.access_token,
      refreshToken: data.refresh_token, // May be rotated
      expiresAt,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      logError('[token-refresh] Refresh timed out');
      return {
        success: false,
        error: 'Token refresh timed out',
        errorType: 'network',
      };
    }

    logError('[token-refresh] Network error:', error);
    return {
      success: false,
      error: `Network error: ${(error as Error).message}`,
      errorType: 'network',
    };
  }
}

/**
 * Check if token needs refresh (expires within threshold).
 */
export function tokenNeedsRefresh(expiresAt: number, thresholdMs: number = 2 * 60 * 1000): boolean {
  return Date.now() + thresholdMs >= expiresAt;
}
