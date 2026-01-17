import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface Credentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
  email?: string;
}

function getCredentialsDir(): string {
  return path.join(os.homedir(), '.wizard');
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

export function isTokenExpired(creds: Credentials): boolean {
  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= creds.expiresAt - bufferMs;
}

export function getAccessToken(): string | null {
  const creds = getCredentials();
  if (!creds) return null;
  if (isTokenExpired(creds)) return null;
  return creds.accessToken;
}
