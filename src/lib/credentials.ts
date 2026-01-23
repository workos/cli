import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Credentials {
  accessToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
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
