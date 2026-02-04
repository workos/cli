/**
 * Credential types and utilities.
 * Storage implementation delegated to credential-store.ts
 */

// Re-export types from credential-store (canonical definitions)
export type { StagingCache, Credentials } from './credential-store.js';

// Re-export storage functions from credential-store
export {
  hasCredentials,
  getCredentials,
  saveCredentials,
  clearCredentials,
  updateTokens,
  getCredentialsPath,
  setInsecureStorage,
} from './credential-store.js';

// Import for use in local functions
import type { Credentials } from './credential-store.js';
import { getCredentials, saveCredentials } from './credential-store.js';

/**
 * Check if token is actually expired (hard expiry check).
 */
export function isTokenExpired(creds: Credentials): boolean {
  return Date.now() >= creds.expiresAt;
}

/**
 * Get access token if available and not expired.
 */
export function getAccessToken(): string | null {
  const creds = getCredentials();
  if (!creds) return null;
  if (isTokenExpired(creds)) return null;
  return creds.accessToken;
}

/**
 * Save staging credentials to the credential cache.
 * Staging credentials are tied to the access token lifecycle.
 */
export function saveStagingCredentials(staging: { clientId: string; apiKey: string }): void {
  const creds = getCredentials();
  if (!creds) return;

  saveCredentials({
    ...creds,
    staging: {
      ...staging,
      fetchedAt: Date.now(),
    },
  });
}

/**
 * Get cached staging credentials if available and access token is still valid.
 * Returns null if no cached credentials or if access token has expired.
 */
export function getStagingCredentials(): { clientId: string; apiKey: string } | null {
  const creds = getCredentials();
  if (!creds?.staging) return null;
  // Invalidate staging credentials when access token expires
  if (isTokenExpired(creds)) return null;
  return { clientId: creds.staging.clientId, apiKey: creds.staging.apiKey };
}
