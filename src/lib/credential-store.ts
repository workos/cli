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

// Inline the Credentials type to avoid circular dependency with credentials.ts
// The canonical type definition lives in credentials.ts
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

// Track if we've already shown the fallback warning this session
let fallbackWarningShown = false;

// Global flag set by CLI argument parsing
let forceInsecureStorage = false;

export function setInsecureStorage(value: boolean): void {
  forceInsecureStorage = value;
}

// ============================================================================
// File Storage (fallback)
// ============================================================================

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
  } catch {
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

// ============================================================================
// Keyring Storage
// ============================================================================

function getKeyringEntry(): Entry {
  return new Entry(SERVICE_NAME, ACCOUNT_NAME);
}

function readFromKeyring(): Credentials | null {
  try {
    const entry = getKeyringEntry();
    const data = entry.getPassword();
    if (!data) return null;
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function writeToKeyring(creds: Credentials): boolean {
  try {
    const entry = getKeyringEntry();
    entry.setPassword(JSON.stringify(creds));
    return true;
  } catch {
    return false;
  }
}

function deleteFromKeyring(): void {
  try {
    const entry = getKeyringEntry();
    entry.deletePassword();
  } catch {
    // Ignore errors - might not exist
  }
}

function isKeyringAvailable(): boolean {
  try {
    const entry = new Entry(SERVICE_NAME, '__probe__');
    entry.setPassword('test');
    entry.deletePassword();
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Unified API
// ============================================================================

function showFallbackWarning(): void {
  if (fallbackWarningShown || forceInsecureStorage) return;
  fallbackWarningShown = true;
  console.warn(
    '\n⚠ Unable to store credentials in system keyring. Using file storage.\n' +
      '  Credentials saved to ~/.workos/credentials.json\n' +
      '  Use --insecure-storage to suppress this warning.\n',
  );
}

/**
 * Check if credentials exist (in keyring or file).
 */
export function hasCredentials(): boolean {
  if (forceInsecureStorage) {
    return fileExists();
  }
  return readFromKeyring() !== null || fileExists();
}

/**
 * Get credentials from keyring or file.
 * Handles migration from file to keyring.
 */
export function getCredentials(): Credentials | null {
  if (forceInsecureStorage) {
    return readFromFile();
  }

  // Try keyring first
  const keyringCreds = readFromKeyring();
  if (keyringCreds) {
    return keyringCreds;
  }

  // Check for file credentials (migration case)
  const fileCreds = readFromFile();
  if (fileCreds) {
    // Attempt to migrate to keyring
    if (writeToKeyring(fileCreds)) {
      deleteFile(); // Clean up after successful migration
      return fileCreds;
    }
    // Keyring unavailable, keep using file
    return fileCreds;
  }

  return null;
}

/**
 * Save credentials to keyring (with file fallback).
 */
export function saveCredentials(creds: Credentials): void {
  if (forceInsecureStorage) {
    writeToFile(creds);
    return;
  }

  // Try keyring first
  if (writeToKeyring(creds)) {
    // Also delete any old file to avoid confusion
    deleteFile();
    return;
  }

  // Fallback to file
  showFallbackWarning();
  writeToFile(creds);
}

/**
 * Clear credentials from both keyring and file.
 */
export function clearCredentials(): void {
  deleteFromKeyring();
  deleteFile();
}

/**
 * Update tokens atomically.
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

  saveCredentials(updated);
}

// Re-export utility functions that don't depend on storage backend
export { getCredentialsPath };
