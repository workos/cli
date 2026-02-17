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
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logWarn } from '../utils/debug.js';

export interface EnvironmentConfig {
  name: string;
  type: 'production' | 'sandbox';
  apiKey: string;
  endpoint?: string;
}

export interface CliConfig {
  activeEnvironment?: string;
  environments: Record<string, EnvironmentConfig>;
}

const SERVICE_NAME = 'workos-cli';
const ACCOUNT_NAME = 'config';

let fallbackWarningShown = false;
let forceInsecureStorage = false;

export function setInsecureConfigStorage(value: boolean): void {
  forceInsecureStorage = value;
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
  try {
    const content = fs.readFileSync(getConfigFilePath(), 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    logWarn('Failed to read config file:', error);
    return null;
  }
}

function writeToFile(config: CliConfig): void {
  const dir = getConfigDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.writeFileSync(getConfigFilePath(), JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
}

function deleteFile(): void {
  if (fileExists()) {
    fs.unlinkSync(getConfigFilePath());
  }
}

function getKeyringEntry(): Entry {
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
  if (forceInsecureStorage) return readFromFile();

  const keyringConfig = readFromKeyring();
  if (keyringConfig) return keyringConfig;

  const fileConfig = readFromFile();
  if (fileConfig) {
    // Migrate file config to keyring if possible
    if (writeToKeyring(fileConfig)) deleteFile();
    return fileConfig;
  }

  return null;
}

export function saveConfig(config: CliConfig): void {
  if (forceInsecureStorage) return writeToFile(config);

  if (writeToKeyring(config)) {
    deleteFile();
  } else {
    showFallbackWarning();
    writeToFile(config);
  }
}

export function clearConfig(): void {
  deleteFromKeyring();
  deleteFile();
}

export function getActiveEnvironment(): EnvironmentConfig | null {
  const config = getConfig();
  if (!config?.activeEnvironment) return null;
  return config.environments[config.activeEnvironment] ?? null;
}

export function getConfigPath(): string {
  return getConfigFilePath();
}
