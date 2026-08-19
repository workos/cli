/**
 * Credential storage abstraction with keyring support and file fallback.
 *
 * Storage priority:
 * 1. If --insecure-storage: use file only
 * 2. Try keyring, fall back to file with warning if unavailable
 */

import { Entry } from '@napi-rs/keyring';
import { DarwinSecurityEntry } from './darwin-keychain.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logWarn } from '../utils/debug.js';
import { observeHostFailure } from './host-probe.js';

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

const SERVICE_NAME = 'workos-cli';
const ACCOUNT_NAME = 'credentials';

let fallbackWarningShown = false;
let forceInsecureStorage = false;
let migrationAttempted = false;

/**
 * In-process cache: a single CLI run reads credentials from many call sites
 * (auth, telemetry, token refresh, ...). Each uncached keyring read is a
 * separate keychain ACL check — on macOS with an untrusted binary that means
 * one password dialog PER READ. Cache the first result; saves keep it
 * coherent (all refresh paths write through saveCredentials in-process).
 * undefined = not loaded yet.
 */
let cachedCreds: Credentials | null | undefined;

export function setInsecureStorage(value: boolean): void {
  forceInsecureStorage = value;
  migrationAttempted = false;
  cachedCreds = undefined;
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
  const filePath = getCredentialsPath();
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (!isValidCredentials(parsed)) {
      logWarn('[credential-store] file: stored credentials are missing required fields; treating as logged out');
      return null;
    }
    return parsed;
  } catch (error) {
    observeHostFailure('home-fs', error, {
      operation: 'read',
      target: filePath,
      label: 'credential fallback file',
    });
    logWarn('Failed to read credentials file:', error);
    return null;
  }
}

function writeToFile(creds: Credentials): void {
  const dir = getCredentialsDir();
  const filePath = getCredentialsPath();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(filePath, JSON.stringify(creds, null, 2), {
      mode: 0o600,
    });
  } catch (error) {
    observeHostFailure('home-fs', error, {
      operation: 'write',
      target: filePath,
      label: 'credential fallback file',
    });
    throw error;
  }
}

function deleteFile(): void {
  const filePath = getCredentialsPath();
  if (fileExists()) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      observeHostFailure('home-fs', error, {
        operation: 'delete',
        target: filePath,
        label: 'credential fallback file',
      });
      throw error;
    }
  }
}

interface KeyringEntry {
  getPassword(): string | null;
  setPassword(password: string): void;
  deletePassword(): void;
}

function getKeyringEntry(): KeyringEntry {
  // On macOS, go through /usr/bin/security (stable Apple-signed binary)
  // instead of the native binding: the ad-hoc-signed CLI binary changes
  // signature every release, so native keychain access prompts per version.
  // See darwin-keychain.ts; revert once releases are Developer ID signed.
  if (process.platform === 'darwin') {
    return new DarwinSecurityEntry(SERVICE_NAME, ACCOUNT_NAME);
  }
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
    const parsed: unknown = JSON.parse(data);
    if (!isValidCredentials(parsed)) {
      logWarn('[credential-store] keyring: stored credentials are missing required fields; treating as logged out');
      return null;
    }
    return parsed;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logWarn(`[credential-store] keyring read failed: ${msg}`);
    observeHostFailure('keychain', error, {
      operation: 'read',
      target: `${SERVICE_NAME}/${ACCOUNT_NAME}`,
      label: 'credential keychain entry',
    });
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
    observeHostFailure('keychain', error, {
      operation: 'write',
      target: `${SERVICE_NAME}/${ACCOUNT_NAME}`,
      label: 'credential keychain entry',
    });
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
      observeHostFailure('keychain', error, {
        operation: 'delete',
        target: `${SERVICE_NAME}/${ACCOUNT_NAME}`,
        label: 'credential keychain entry',
      });
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
  // Validate rather than just probing for a file/entry: a malformed blob must
  // read as logged-out here too, so this never disagrees with getCredentials().
  // (readFrom* both run isValidCredentials; avoids getCredentials()'s keyring
  // migration side effect.)
  if (cachedCreds !== undefined) return cachedCreds !== null;
  if (forceInsecureStorage) {
    return readFromFile() !== null;
  }
  const keyringCreds = readFromKeyring();
  if (keyringCreds) {
    // Safe to cache: getCredentials() would return this without migrating.
    // A file-only hit is NOT cached so its migration still runs there.
    cachedCreds = keyringCreds;
    return true;
  }
  return readFromFile() !== null;
}

export function getCredentials(): Credentials | null {
  if (cachedCreds !== undefined) return cachedCreds;

  if (forceInsecureStorage) {
    cachedCreds = readFromFile();
    return cachedCreds;
  }

  const keyringCreds = readFromKeyring();
  if (keyringCreds) {
    cachedCreds = keyringCreds;
    return keyringCreds;
  }

  const fileCreds = readFromFile();
  if (fileCreds) {
    if (!migrationAttempted) {
      migrationAttempted = true;
      writeToKeyring(fileCreds);
    }
    cachedCreds = fileCreds;
    return fileCreds;
  }

  cachedCreds = null;
  return null;
}

export function saveCredentials(creds: Credentials): void {
  if (forceInsecureStorage) {
    writeToFile(creds);
    cachedCreds = creds;
    return;
  }

  if (!writeToKeyring(creds)) {
    showFallbackWarning();
    writeToFile(creds);
  }
  cachedCreds = creds;
}

export function clearCredentials(): void {
  deleteFromKeyring();
  deleteFile();
  migrationAttempted = false;
  cachedCreds = undefined;
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
