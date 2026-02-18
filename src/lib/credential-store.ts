/**
 * Credential storage abstraction with keyring support and file fallback.
 *
 * Storage priority:
 * 1. If --insecure-storage: use file only
 * 2. Try keyring, fall back to file with warning if unavailable
 */

import { Entry } from '@napi-rs/keyring';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logWarn } from '../utils/debug.js';

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

const SERVICE_NAME = 'workos-cli';
const ACCOUNT_NAME = 'credentials';

let fallbackWarningShown = false;
let forceInsecureStorage = false;

export function setInsecureStorage(value: boolean): void {
  forceInsecureStorage = value;
}

function getCredentialsDir(): string {
  return path.join(os.homedir(), '.workos');
}

function getCredentialsPath(): string {
  return path.join(getCredentialsDir(), 'credentials.json');
}

function fileExists(): boolean {
  return fs.existsSync(getCredentialsPath());
}

function readFromFile(): Credentials | null {
  if (!fileExists()) return null;
  try {
    const content = fs.readFileSync(getCredentialsPath(), 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logWarn('Failed to read credentials file:', error);
    return null;
  }
}

function writeToFile(creds: Credentials): void {
  const dir = getCredentialsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(getCredentialsPath(), JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

function deleteFile(): void {
  if (fileExists()) {
    fs.unlinkSync(getCredentialsPath());
  }
}

function getKeyringEntry(): Entry {
  return new Entry(SERVICE_NAME, ACCOUNT_NAME);
}

function readFromKeyring(): Credentials | null {
  try {
    const entry = getKeyringEntry();
    const data = entry.getPassword();
    if (!data) {
      logWarn('[credential-store] keyring: entry exists but data is null/empty');
      return null;
    }
    return JSON.parse(data);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarn(`[credential-store] keyring read failed: ${msg}`);
    return null;
  }
}

function writeToKeyring(creds: Credentials): boolean {
  try {
    const entry = getKeyringEntry();
    entry.setPassword(JSON.stringify(creds));
    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarn(`[credential-store] keyring write failed: ${msg}`);
    return false;
  }
}

function deleteFromKeyring(): void {
  try {
    const entry = getKeyringEntry();
    entry.deletePassword();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('not found') && !msg.includes('No such')) {
      logWarn('Failed to delete from keyring:', error);
    }
  }
}

function showFallbackWarning(): void {
  if (fallbackWarningShown || forceInsecureStorage) return;
  fallbackWarningShown = true;
  logWarn(
    'Unable to store credentials in system keyring. Using file storage.',
    'Credentials saved to ~/.workos/credentials.json',
    'Use --insecure-storage to suppress this warning.',
  );
}

export function hasCredentials(): boolean {
  if (forceInsecureStorage) {
    return fileExists();
  }
  return readFromKeyring() !== null || fileExists();
}

export function getCredentials(): Credentials | null {
  if (forceInsecureStorage) {
    logWarn('[credential-store] getCredentials: insecure mode, reading file only');
    return readFromFile();
  }

  const keyringCreds = readFromKeyring();
  if (keyringCreds) {
    logWarn('[credential-store] getCredentials: found in keyring');
    return keyringCreds;
  }

  logWarn('[credential-store] getCredentials: keyring miss, trying file fallback');
  const filePath = getCredentialsPath();
  logWarn(`[credential-store] getCredentials: file path = ${filePath}, exists = ${fileExists()}`);

  const fileCreds = readFromFile();
  if (fileCreds) {
    logWarn('[credential-store] getCredentials: found in file, returning');
    writeToKeyring(fileCreds); // best-effort migrate, but keep file
    return fileCreds;
  }

  logWarn('[credential-store] getCredentials: no credentials found in keyring or file');
  return null;
}

export function saveCredentials(creds: Credentials): void {
  if (forceInsecureStorage) {
    logWarn('[credential-store] saveCredentials: insecure mode, writing file only');
    return writeToFile(creds);
  }

  // Always write to file as durable fallback — keyring can become unreadable
  // after binary rebuilds (macOS code signature changes).
  logWarn(`[credential-store] saveCredentials: writing file to ${getCredentialsPath()}`);
  writeToFile(creds);
  logWarn(`[credential-store] saveCredentials: file written, exists = ${fileExists()}`);

  const keyringOk = writeToKeyring(creds);
  logWarn(`[credential-store] saveCredentials: keyring write = ${keyringOk ? 'ok' : 'FAILED'}`);
  if (!keyringOk) {
    showFallbackWarning();
  }
}

export function clearCredentials(): void {
  deleteFromKeyring();
  deleteFile();
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
  const filePath = getCredentialsPath();
  const filePresent = fileExists();

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
    const entry = getKeyringEntry();
    const data = entry.getPassword();
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

  lines.push(`insecureStorage=${forceInsecureStorage}`);
  return lines;
}

export { getCredentialsPath };
