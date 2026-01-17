/**
 * Background token refresh manager for long-running agent sessions.
 * Periodically checks token expiry and refreshes before it expires.
 */

import {
  getCredentials,
  saveCredentials,
  needsRefresh as credentialsNeedsRefresh,
  Credentials,
} from './credentials.js';
import { debug, logToFile } from '../utils/debug.js';
import { getSettings } from './settings.js';
import { WorkOS } from '@workos-inc/node';

// Check every 10 seconds for short-lived tokens
const REFRESH_CHECK_INTERVAL_MS = 10 * 1000;

/**
 * Extract expiry time from JWT token
 */
function getJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    );
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

let refreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Refresh the token and update environment
 */
async function refreshToken(): Promise<boolean> {
  const creds = getCredentials();
  if (!creds) {
    logToFile('[TokenManager] No credentials found');
    return false;
  }

  if (!credentialsNeedsRefresh(creds)) {
    return true; // Token still valid
  }

  const settings = getSettings();
  const clientId = settings.cliAuth.clientId;

  if (!clientId || clientId.includes('REPLACE')) {
    logToFile('[TokenManager] CLI auth not configured');
    return false;
  }

  logToFile('[TokenManager] Token expiring soon, refreshing...');
  debug('[TokenManager] Token expiring soon, refreshing...');

  try {
    const workos = new WorkOS(undefined, { clientId });

    const result = await workos.userManagement.authenticateWithRefreshToken({
      clientId,
      refreshToken: creds.refreshToken,
    });

    // Extract actual expiry from JWT, fallback to 15 min
    const jwtExpiry = getJwtExpiry(result.accessToken);
    const expiresAt = jwtExpiry ?? Date.now() + 15 * 60 * 1000;

    const newCreds: Credentials = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
      userId: creds.userId,
      email: creds.email,
    };

    saveCredentials(newCreds);

    // Update the environment variable so subsequent requests use new token
    process.env.ANTHROPIC_AUTH_TOKEN = newCreds.accessToken;

    const expiresInSec = Math.round((expiresAt - Date.now()) / 1000);
    logToFile(`[TokenManager] Token refreshed, expires in ${expiresInSec}s`);
    debug(`[TokenManager] Token refreshed, expires in ${expiresInSec}s`);

    return true;
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    logToFile('[TokenManager] Token refresh failed:', err.message);
    debug('[TokenManager] Token refresh failed:', err.message);
    return false;
  }
}

/**
 * Start background token refresh manager.
 * Call this when starting a long-running agent session.
 */
export function startTokenManager(): void {
  if (refreshInterval) {
    return; // Already running
  }

  logToFile('[TokenManager] Starting background token refresh');
  debug('[TokenManager] Starting background token refresh');

  // Do an initial check
  refreshToken();

  // Set up periodic refresh
  refreshInterval = setInterval(async () => {
    const success = await refreshToken();
    if (!success) {
      logToFile('[TokenManager] Background refresh failed - session may expire');
    }
  }, REFRESH_CHECK_INTERVAL_MS);
}

/**
 * Stop background token refresh manager.
 * Call this when the agent session ends.
 */
export function stopTokenManager(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
    logToFile('[TokenManager] Stopped background token refresh');
    debug('[TokenManager] Stopped background token refresh');
  }
}
