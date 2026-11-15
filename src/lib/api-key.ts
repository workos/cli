/**
 * Credential resolution for the REST commands (`workos api`, connection,
 * directory, audit-log, vault, api-key, and the workflow/debug commands).
 *
 * Priority chain (resolveApiKey):
 * 1. --api-key flag
 * 2. WORKOS_API_KEY environment variable
 * 3. Workload identity federation in GitHub Actions (see wif.ts): a
 *    short-lived WorkOS access token, primed by primeApiCredentials()
 * 4. Active environment's stored API key
 */

import { getActiveEnvironment } from './config-store.js';
import { exitWithError } from '../utils/output.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import {
  exitWithMissingIdTokenPermission,
  exitWithWifUnsupported,
  getWifAccessToken,
  getWifState,
  peekWifAccessToken,
} from './wif.js';

const DEFAULT_BASE_URL = 'https://api.workos.com';

export interface ApiKeyOptions {
  apiKey?: string;
}

/**
 * Resolve the credential for a REST call. Synchronous, so when workload
 * identity federation applies the token must already be primed (see
 * primeApiCredentials); an unprimed call site exits rather than silently
 * falling back to a stored key.
 */
export function resolveApiKey(options?: ApiKeyOptions): string {
  const explicit = resolveExplicitApiKey(options);
  if (explicit) return explicit;

  const wifState = getWifState();
  if (wifState === 'ready') {
    return peekWifAccessToken() ?? exitWithWifUnsupported();
  }

  const stored = getActiveEnvironment()?.apiKey;
  if (stored) return stored;

  if (wifState === 'missing_id_token_env') exitWithMissingIdTokenPermission();

  exitWithError({
    code: 'no_api_key',
    message: `No API key configured. Run \`${formatWorkOSCommand('profile add')}\` to configure an environment, or set WORKOS_API_KEY.`,
  });
}

/**
 * Async half of credential resolution. When WIF is the credential that
 * resolveApiKey() will return, exchange (or refresh) the access token now.
 * A no-op otherwise, so the API key and profile paths never touch the network.
 */
export async function primeApiCredentials(options?: ApiKeyOptions): Promise<void> {
  if (resolveExplicitApiKey(options)) return;
  if (getWifState() === 'ready') await getWifAccessToken();
}

/** resolveApiKey() for call sites that can await: primes WIF first. */
export async function resolveApiKeyAsync(options?: ApiKeyOptions): Promise<string> {
  await primeApiCredentials(options);
  return resolveApiKey(options);
}

/**
 * Flag → WORKOS_API_KEY → stored key, without WIF. Used by `workos
 * migrations`, which hands the key to a runtime bundle that can't refresh a
 * short-lived token.
 */
export function resolveOptionalApiKey(options?: ApiKeyOptions): string | undefined {
  const explicit = resolveExplicitApiKey(options);
  if (explicit) return explicit;

  const activeEnv = getActiveEnvironment();
  if (activeEnv?.apiKey) return activeEnv.apiKey;

  return undefined;
}

function resolveExplicitApiKey(options?: ApiKeyOptions): string | undefined {
  if (options?.apiKey) return options.apiKey;

  const envVar = process.env.WORKOS_API_KEY;
  if (envVar) return envVar;

  return undefined;
}

export type ApiBaseUrlSource = 'env' | 'profile' | 'default';

export interface ResolvedApiBaseUrl {
  baseUrl: string;
  source: ApiBaseUrlSource;
  /**
   * Provenance for display: the env var name when `source === 'env'`,
   * or the active environment name when `source === 'profile'`.
   */
  via?: string;
}

/**
 * Resolve the API base URL along with where it came from.
 *
 * Precedence: WORKOS_API_URL → WORKOS_API_BASE_URL (alias) → active profile
 * endpoint → default. Env-supplied values are validated and normalized so a
 * typo fails loudly instead of surfacing as an opaque `new URL()` TypeError
 * deep in a command.
 */
export function getApiBaseUrlSource(): ResolvedApiBaseUrl {
  if (process.env.WORKOS_API_URL) {
    return {
      baseUrl: normalizeApiBaseUrl(process.env.WORKOS_API_URL, 'WORKOS_API_URL'),
      source: 'env',
      via: 'WORKOS_API_URL',
    };
  }
  if (process.env.WORKOS_API_BASE_URL) {
    return {
      baseUrl: normalizeApiBaseUrl(process.env.WORKOS_API_BASE_URL, 'WORKOS_API_BASE_URL'),
      source: 'env',
      via: 'WORKOS_API_BASE_URL',
    };
  }

  const activeEnv = getActiveEnvironment();
  if (activeEnv?.endpoint) {
    return { baseUrl: activeEnv.endpoint, source: 'profile', via: activeEnv.name };
  }

  return { baseUrl: DEFAULT_BASE_URL, source: 'default' };
}

export function resolveApiBaseUrl(): string {
  return getApiBaseUrlSource().baseUrl;
}

function normalizeApiBaseUrl(value: string, varName: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    exitWithError({
      code: 'invalid_api_url',
      message: `${varName} is not a valid URL: "${value}". Example: ${varName}=http://localhost:7777`,
    });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    exitWithError({
      code: 'invalid_api_url',
      message: `${varName} must use http or https (got "${parsed.protocol}"). Example: ${varName}=http://localhost:7777`,
    });
  }
  // Strip trailing slashes so paths concatenate cleanly (`${base}/users`).
  return value.replace(/\/+$/, '');
}
