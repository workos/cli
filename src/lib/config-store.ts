/**
 * CLI config storage: keychain-backed with file fallback, via KeyringStore
 * (backend selection, in-process cache, migration — see keyring-store.ts).
 *
 * Stores environment configurations (names, API keys, endpoints) separately
 * from OAuth credentials. Uses a second keyring entry under the same service.
 */

import fs from 'node:fs';
import { KeyringStore } from './keyring-store.js';

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

const store = new KeyringStore<CliConfig>({
  serviceName: 'workos-cli',
  accountName: 'config',
  fileName: 'config.json',
  label: 'config',
  verifySaveReadBack: true,
});

export function setInsecureConfigStorage(value: boolean): void {
  store.setInsecure(value);
}

export function getConfig(): CliConfig | null {
  return store.get();
}

export function saveConfig(config: CliConfig): void {
  store.save(config);
}

export function clearConfig(): void {
  store.clear();
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
  return store.filePath;
}

/**
 * Diagnostic info about config storage state — for debugging config persistence failures.
 */
export function diagnoseConfig(): string[] {
  const lines: string[] = [];
  const filePath = store.filePath;
  const filePresent = fs.existsSync(filePath);

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
    const data = store.readKeyringRaw();
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

  lines.push(`insecureStorage=${store.insecure}`);
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
