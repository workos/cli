import { WorkOS } from '@workos-inc/node';
import {
  getCredentials,
  saveCredentials,
  needsRefresh,
  Credentials,
} from './credentials.js';
import { debug, logToFile } from '../utils/debug.js';
import { getSettings } from './settings.js';

/**
 * Extract expiry time from JWT token
 */
function getJwtExpiry(token: string): number | null {
  try {
    // JWT is base64url encoded: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    // Decode payload (second part)
    const payload = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf-8')
    );

    if (typeof payload.exp === 'number') {
      // exp is in seconds, convert to milliseconds
      return payload.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

export interface RefreshResult {
  success: boolean;
  credentials?: Credentials;
  error?: string;
}

export async function ensureValidToken(): Promise<RefreshResult> {
  const settings = getSettings();
  const clientId = settings.cliAuth.clientId;

  if (!clientId || clientId.includes('REPLACE')) {
    logToFile('[ensureValidToken] CLI auth not configured');
    return { success: false, error: 'CLI auth not configured' };
  }

  const creds = getCredentials();

  if (!creds) {
    logToFile('[ensureValidToken] No credentials found');
    return { success: false, error: 'Not authenticated' };
  }

  logToFile(`[ensureValidToken] Token expiresAt: ${new Date(creds.expiresAt).toISOString()}`);
  logToFile(`[ensureValidToken] Current time: ${new Date().toISOString()}`);
  logToFile(`[ensureValidToken] needsRefresh: ${needsRefresh(creds)}`);

  // Token still valid and doesn't need refresh yet
  if (!needsRefresh(creds)) {
    logToFile('[ensureValidToken] Token still valid, no refresh needed');
    return { success: true, credentials: creds };
  }

  // Need to refresh
  logToFile('[ensureValidToken] Token needs refresh, attempting...');

  try {
    const workos = new WorkOS(undefined, { clientId });

    logToFile('[ensureValidToken] Calling WorkOS authenticateWithRefreshToken');
    const result = await workos.userManagement.authenticateWithRefreshToken({
      clientId,
      refreshToken: creds.refreshToken,
    });

    // Extract actual expiry from JWT, fallback to 15 min
    const jwtExpiry = getJwtExpiry(result.accessToken);
    const expiresAt = jwtExpiry ?? Date.now() + 15 * 60 * 1000;

    logToFile(`[ensureValidToken] JWT expiry from token: ${jwtExpiry ? new Date(jwtExpiry).toISOString() : 'not found'}`);

    const newCreds: Credentials = {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt,
      userId: creds.userId,
      email: creds.email,
    };

    saveCredentials(newCreds);
    logToFile(`[ensureValidToken] Token refreshed, new expiresAt: ${new Date(expiresAt).toISOString()}`);

    return { success: true, credentials: newCreds };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    logToFile(`[ensureValidToken] Refresh failed: ${err.code} - ${err.message}`);

    // Refresh token might be revoked or expired
    if (err.code === 'invalid_grant') {
      return {
        success: false,
        error: 'Session expired. Run `wizard login` to re-authenticate.',
      };
    }

    return { success: false, error: err.message || 'Token refresh failed' };
  }
}
