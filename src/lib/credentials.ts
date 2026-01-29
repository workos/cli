import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface StagingCache {
  clientId: string;
  apiKey: string;
  fetchedAt: number;
}

export interface Credentials {
  accessToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
  staging?: StagingCache;
  refreshToken?: string;
}

function getCredentialsDir(): string {
  return path.join(os.homedir(), '.workos');
}

export function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), 'credentials.json');
}

export function hasCredentials(): boolean {
  return fs.existsSync(getCredentialsPath());
}

export function getCredentials(): Credentials | null {
  if (!hasCredentials()) return null;
  try {
    const content = fs.readFileSync(getCredentialsPath(), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  const dir = getCredentialsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  if (hasCredentials()) {
    fs.unlinkSync(getCredentialsPath());
  }
}

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

/**
 * Atomically update tokens in credentials file.
 * Uses write-to-temp + rename pattern for atomic updates.
 */
export function updateTokens(accessToken: string, expiresAt: number, refreshToken?: string): void {
  const creds = getCredentials();
  if (!creds) {
    throw new Error('No existing credentials to update');
  }

  const updated: Credentials = {
    ...creds,
    accessToken,
    expiresAt,
    ...(refreshToken && { refreshToken }),
  };

  // Atomic write: temp file + rename
  const credPath = getCredentialsPath();
  const tempPath = `${credPath}.${crypto.randomUUID()}.tmp`;

  try {
    fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), { mode: 0o600 });
    fs.renameSync(tempPath, credPath);
  } catch (error) {
    // Clean up temp file if rename failed
    try {
      fs.unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
