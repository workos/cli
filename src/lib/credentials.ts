export type { StagingCache, Credentials } from './credential-store.js';

export {
  hasCredentials,
  getCredentials,
  saveCredentials,
  clearCredentials,
  updateTokens,
  getCredentialsPath,
  setInsecureStorage,
} from './credential-store.js';

import type { Credentials } from './credential-store.js';
import { getCredentials, saveCredentials } from './credential-store.js';

export function isTokenExpired(creds: Credentials): boolean {
  return Date.now() >= creds.expiresAt;
}

export function getAccessToken(): string | null {
  const creds = getCredentials();
  if (!creds) return null;
  if (isTokenExpired(creds)) return null;
  return creds.accessToken;
}

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

export function getStagingCredentials(): { clientId: string; apiKey: string } | null {
  const creds = getCredentials();
  if (!creds?.staging) return null;
  if (isTokenExpired(creds)) return null;
  return { clientId: creds.staging.clientId, apiKey: creds.staging.apiKey };
}
