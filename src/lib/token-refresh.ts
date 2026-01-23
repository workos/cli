import { getCredentials, isTokenExpired, Credentials } from './credentials.js';
import { logInfo } from '../utils/debug.js';

export interface TokenValidationResult {
  success: boolean;
  credentials?: Credentials;
  error?: string;
}

/**
 * Check if the current token is valid.
 * If expired, returns an error prompting re-authentication.
 * No refresh is attempted - refresh tokens are not stored for security.
 */
export async function ensureValidToken(): Promise<TokenValidationResult> {
  const creds = getCredentials();

  if (!creds) {
    logInfo('[ensureValidToken] No credentials found');
    return { success: false, error: 'Not authenticated' };
  }

  logInfo(`[ensureValidToken] Token expiresAt: ${new Date(creds.expiresAt).toISOString()}`);
  logInfo(`[ensureValidToken] Current time: ${new Date().toISOString()}`);

  if (isTokenExpired(creds)) {
    logInfo('[ensureValidToken] Token expired, re-authentication required');
    return {
      success: false,
      error: 'Session expired. Run `wizard login` to re-authenticate.',
    };
  }

  logInfo('[ensureValidToken] Token valid');
  return { success: true, credentials: creds };
}
