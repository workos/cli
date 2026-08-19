/**
 * CLI config storage abstraction with keyring support and file fallback.
 *
 * Stores environment configurations (names, API keys, endpoints) separately
 * from OAuth credentials. Uses a second keyring entry under the same service.
 *
 * Storage priority:
 * 1. If insecure storage forced: use file only
 * 2. Try keyring, fall back to file with warning if unavailable
 */

import { Entry } from '@napi-rs/keyring';
import { DarwinSecurityEntry } from './darwin-keychain.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logWarn } from '../utils/debug.js';
import { observeHostFailure } from './host-probe.js';

interface BaseEnvironmentConfig {
  name: string;
  apiKey: string;
  endpoint?: string;
  /** Email of the account that owns this environment. Stamped when `auth login` provisions Staging for a known account; undefined for unclaimed/manually-added envs. */
  ownerEmail?: string;
  /** User ID of the account that owns this environment. Stamped alongside ownerEmail. */
  ownerUserId?: string;
}

export interface ClaimedEnvironmentConfig extends BaseEnvironmentConfig {
  type: 'production' | 'sandbox';
  clientId?: string;
}

export interface UnclaimedEnvironmentConfig extends BaseEnvironmentConfig {
  type: 'unclaimed';
  clientId: string;
  claimToken: string;
}

export type EnvironmentConfig = ClaimedEnvironmentConfig | UnclaimedEnvironmentConfig;

/**
 * Type guard — narrows to UnclaimedEnvironmentConfig with required clientId and claimToken.
 */
export function isUnclaimedEnvironment(env: EnvironmentConfig): env is UnclaimedEnvironmentConfig {
  return env.type === 'unclaimed';
}

export interface CliConfig {
  activeEnvironment?: string;
  environments: Record<string, EnvironmentConfig>;
}

const SERVICE_NAME = 'workos-cli';
const ACCOUNT_NAME = 'config';

let fallbackWarningShown = false;
let forceInsecureStorage = false;
let migrationAttempted = false;

/**
 * In-process cache — same rationale as credential-store: getConfig() is
 * called several times per run, and each uncached keyring read is a separate
 * keychain ACL check (one password dialog per read on an untrusted binary).
 * undefined = not loaded yet.
 */
let cachedConfig: CliConfig | null | undefined;

export function setInsecureConfigStorage(value: boolean): void {
  forceInsecureStorage = value;
  migrationAttempted = false;
  cachedConfig = undefined;
}

function getConfigDir(): string {
  return path.join(os.homedir(), '.workos');
}

function getConfigFilePath(): string {
  return path.join(getConfigDir(), 'config.json');
}

function fileExists(): boolean {
  return fs.existsSync(getConfigFilePath());
}

function readFromFile(): CliConfig | null {
  if (!fileExists()) return null;
  const filePath = getConfigFilePath();
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    observeHostFailure('home-fs', error, {
      operation: 'read',
      target: filePath,
      label: 'config fallback file',
    });
    logWarn('Failed to read config file:', error);
    return null;
  }
}

function writeToFile(config: CliConfig): void {
  const dir = getConfigDir();
  const filePath = getConfigFilePath();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
  } catch (error) {
    observeHostFailure('home-fs', error, {
      operation: 'write',
      target: filePath,
      label: 'config fallback file',
    });
    throw error;
  }
}

function deleteFile(): void {
  const filePath = getConfigFilePath();
  if (fileExists()) {
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      observeHostFailure('home-fs', error, {
        operation: 'delete',
        target: filePath,
        label: 'config fallback file',
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
  // Same backend selection as credential-store: on macOS go through
  // /usr/bin/security so keychain trust survives across ad-hoc-signed
  // releases. See darwin-keychain.ts.
  if (process.platform === 'darwin') {
    return new DarwinSecurityEntry(SERVICE_NAME, ACCOUNT_NAME);
  }
  return new Entry(SERVICE_NAME, ACCOUNT_NAME);
}

function readFromKeyring(): CliConfig | null {
  try {
    const entry = getKeyringEntry();
    const data = entry.getPassword();
    if (!data) return null;
    return JSON.parse(data);
  } catch (error) {
    logWarn('Failed to read config from keyring:', error);
    observeHostFailure('keychain', error, {
      operation: 'read',
      target: `${SERVICE_NAME}/${ACCOUNT_NAME}`,
      label: 'config keychain entry',
    });
    return null;
  }
}

function writeToKeyring(config: CliConfig): boolean {
  try {
    const entry = getKeyringEntry();
    entry.setPassword(JSON.stringify(config));
    return true;
  } catch (error) {
    logWarn('Failed to write config to keyring:', error);
    observeHostFailure('keychain', error, {
      operation: 'write',
      target: `${SERVICE_NAME}/${ACCOUNT_NAME}`,
      label: 'config keychain entry',
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
      logWarn('Failed to delete config from keyring:', error);
      observeHostFailure('keychain', error, {
        operation: 'delete',
        target: `${SERVICE_NAME}/${ACCOUNT_NAME}`,
        label: 'config keychain entry',
      });
    }
  }
}

function showFallbackWarning(): void {
  if (fallbackWarningShown || forceInsecureStorage) return;
  fallbackWarningShown = true;
  logWarn(
    'Unable to store config in system keyring. Using file storage.',
    'Config saved to ~/.workos/config.json',
    'Use --insecure-storage to suppress this warning.',
  );
}

export function getConfig(): CliConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  if (forceInsecureStorage) {
    cachedConfig = readFromFile();
    return cachedConfig;
  }

  const keyringConfig = readFromKeyring();
  if (keyringConfig) {
    cachedConfig = keyringConfig;
    return keyringConfig;
  }

  const fileConfig = readFromFile();
  if (fileConfig) {
    if (!migrationAttempted) {
      migrationAttempted = true;
      writeToKeyring(fileConfig);
    }
    cachedConfig = fileConfig;
    return fileConfig;
  }

  cachedConfig = null;
  return null;
}

export function saveConfig(config: CliConfig): void {
  if (forceInsecureStorage) {
    writeToFile(config);
    cachedConfig = config;
    return;
  }

  if (!writeToKeyring(config)) {
    showFallbackWarning();
    writeToFile(config);
    cachedConfig = config;
    return;
  }

  // Verify the keyring write is readable (guards against silent keyring failures
  // where setPassword succeeds but getPassword returns null in the same process)
  if (!readFromKeyring()) {
    logWarn('Keyring write succeeded but read-back failed — falling back to file');
    writeToFile(config);
  }
  cachedConfig = config;
}

export function clearConfig(): void {
  deleteFromKeyring();
  deleteFile();
  migrationAttempted = false;
  cachedConfig = undefined;
}

export function getActiveEnvironment(): EnvironmentConfig | null {
  const config = getConfig();
  if (!config?.activeEnvironment) return null;
  return config.environments[config.activeEnvironment] ?? null;
}

/**
 * Set the active environment by name.
 *
 * No-op when there is no config or the named environment does not exist —
 * callers should not be able to point `activeEnvironment` at a missing key.
 */
export function setActiveEnvironment(name: string): void {
  const config = getConfig();
  if (!config || !config.environments[name]) return;
  config.activeEnvironment = name;
  saveConfig(config);
}

/** Pick a non-colliding environments key: `base`, else `base-2`, `base-3`, … */
export function freshEnvKey(config: CliConfig, base: string): string {
  if (!config.environments[base]) return base;
  let i = 2;
  while (config.environments[`${base}-${i}`]) i++;
  return `${base}-${i}`;
}

export function getConfigPath(): string {
  return getConfigFilePath();
}

/**
 * Diagnostic info about config storage state — for debugging config persistence failures.
 */
export function diagnoseConfig(): string[] {
  const lines: string[] = [];
  const filePath = getConfigFilePath();
  const filePresent = fileExists();

  lines.push(`file: ${filePath} (exists=${filePresent})`);

  if (filePresent) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as Partial<CliConfig>;
      const envCount = parsed.environments ? Object.keys(parsed.environments).length : 0;
      lines.push(`file config: active=${parsed.activeEnvironment ?? 'none'}, environments=${envCount}`);
    } catch (e) {
      lines.push(`file config: parse error — ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  try {
    const entry = getKeyringEntry();
    const data = entry.getPassword();
    if (data) {
      const parsed = JSON.parse(data) as Partial<CliConfig>;
      const envCount = parsed.environments ? Object.keys(parsed.environments).length : 0;
      lines.push(`keyring: found, active=${parsed.activeEnvironment ?? 'none'}, environments=${envCount}`);
    } else {
      lines.push('keyring: empty (getPassword returned null)');
    }
  } catch (e) {
    lines.push(`keyring: error — ${e instanceof Error ? e.message : String(e)}`);
  }

  lines.push(`insecureStorage=${forceInsecureStorage}`);
  return lines;
}

/**
 * Mark the active unclaimed environment as claimed.
 * Updates type to 'sandbox', removes the claim token, and renames
 * the environment key from 'unclaimed' to 'sandbox'.
 */
export function markEnvironmentClaimed(): void {
  const config = getConfig();
  if (!config?.activeEnvironment) return;
  const oldKey = config.activeEnvironment;
  const env = config.environments[oldKey];
  if (env && env.type === 'unclaimed') {
    // Pick a key that won't overwrite an existing environment
    let newKey = 'sandbox';
    if (oldKey !== newKey && config.environments[newKey]) {
      newKey = oldKey; // keep existing key if 'sandbox' is already taken
    }

    const claimed: ClaimedEnvironmentConfig = {
      name: newKey,
      type: 'sandbox',
      apiKey: env.apiKey,
      clientId: env.clientId,
      ...(env.endpoint && { endpoint: env.endpoint }),
      ...(env.ownerEmail && { ownerEmail: env.ownerEmail }),
      ...(env.ownerUserId && { ownerUserId: env.ownerUserId }),
    };

    if (oldKey !== newKey) {
      delete config.environments[oldKey];
    }
    config.environments[newKey] = claimed;
    config.activeEnvironment = newKey;

    saveConfig(config);
  }
}
