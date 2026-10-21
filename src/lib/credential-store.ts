/**
 * Credential storage: keychain-backed with file fallback, via KeyringStore
 * (backend selection, in-process cache, migration — see keyring-store.ts).
 *
 * Storage priority:
 * 1. If --insecure-storage: use file only
 * 2. Try keyring, fall back to file with warning if unavailable
 */

import fs from 'node:fs';
import { KeyringStore } from './keyring-store.js';

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

/**
 * A stored blob missing required fields (partial write, older schema) must
 * read as logged-out: consumers assume accessToken/expiresAt/userId exist,
 * and an invalid object otherwise crashes every authenticated command —
 * `new Date(undefined).toISOString()` throws — bricking the CLI until the
 * entry is manually deleted.
 */
function isValidCredentials(value: unknown): value is Credentials {
  const creds = value as Credentials | null;
  return (
    typeof creds === 'object' &&
    creds !== null &&
    typeof creds.accessToken === 'string' &&
    Number.isFinite(creds.expiresAt) &&
    typeof creds.userId === 'string'
  );
}

const store = new KeyringStore<Credentials>({
  serviceName: 'workos-cli',
  accountName: 'credentials',
  fileName: 'credentials.json',
  label: 'credentials',
  validate: (parsed) => (isValidCredentials(parsed) ? parsed : null),
});

export function setInsecureStorage(value: boolean): void {
  store.setInsecure(value);
}

export function hasCredentials(): boolean {
  return store.has();
}

export function getCredentials(): Credentials | null {
  return store.get();
}

export function saveCredentials(creds: Credentials): void {
  store.save(creds);
}

export function clearCredentials(): void {
  store.clear();
}

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

  saveCredentials(updated);
}

/**
 * Diagnostic info about credential storage state — for debugging auth failures.
 */
export function diagnoseCredentials(): string[] {
  const lines: string[] = [];
  const filePath = store.filePath;
  const filePresent = fs.existsSync(filePath);

  lines.push(`file: ${filePath} (exists=${filePresent})`);

  if (filePresent) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<Credentials>;
      const expired = parsed.expiresAt ? Date.now() >= parsed.expiresAt : 'unknown';
      lines.push(
        `file creds: userId=${parsed.userId ?? 'missing'}, expired=${expired}, hasRefreshToken=${!!parsed.refreshToken}`,
      );
    } catch (e) {
      lines.push(`file creds: parse error — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const data = store.readKeyringRaw();
    if (data) {
      const parsed = JSON.parse(data) as Partial<Credentials>;
      const expired = parsed.expiresAt ? Date.now() >= parsed.expiresAt : 'unknown';
      lines.push(
        `keyring: found, userId=${parsed.userId ?? 'missing'}, expired=${expired}, hasRefreshToken=${!!parsed.refreshToken}`,
      );
    } else {
      lines.push('keyring: empty (getPassword returned null)');
    }
  } catch (e) {
    lines.push(`keyring: error — ${e instanceof Error ? e.message : String(e)}`);
  }

  lines.push(`insecureStorage=${store.insecure}`);
  return lines;
}

export function getCredentialsPath(): string {
  return store.filePath;
}
