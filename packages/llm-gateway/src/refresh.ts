/**
 * Token refresh for the gateway.
 * When an access token is expired, use the refresh token to get a new one.
 */

import { env } from './env.js';

interface RefreshResult {
  success: boolean;
  accessToken?: string;
  error?: string;
}

/**
 * Refresh an access token using a refresh token via WorkOS API
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<RefreshResult> {
  const clientId = env.WORKOS_CLIENT_ID;

  if (!clientId) {
    return { success: false, error: 'WORKOS_CLIENT_ID not configured' };
  }

  try {
    const response = await fetch(
      'https://api.workos.com/user_management/authenticate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.log(`[Refresh] Failed: ${response.status} ${error}`);
      return { success: false, error: `Refresh failed: ${response.status}` };
    }

    const data = (await response.json()) as { access_token: string };
    console.log('[Refresh] Token refreshed successfully');

    return { success: true, accessToken: data.access_token };
  } catch (error: unknown) {
    const err = error as Error;
    console.error('[Refresh] Error:', err.message);
    return { success: false, error: err.message };
  }
}
