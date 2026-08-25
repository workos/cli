/**
 * API key resolution for management commands.
 *
 * Priority chain:
 * 1. --api-key flag
 * 2. WORKOS_API_KEY environment variable
 * 3. Active environment's stored API key
 */

import { getActiveEnvironment } from './config-store.js';
import { exitWithError } from '../utils/output.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

const DEFAULT_BASE_URL = 'https://api.workos.com';

export interface ApiKeyOptions {
  apiKey?: string;
}

export function resolveApiKey(options?: ApiKeyOptions): string {
  const apiKey = resolveOptionalApiKey(options);
  if (apiKey) return apiKey;

  exitWithError({
    code: 'no_api_key',
    message: `No API key configured. Run \`${formatWorkOSCommand('profile add')}\` to configure an environment, or set WORKOS_API_KEY.`,
  });
}

export function resolveOptionalApiKey(options?: ApiKeyOptions): string | undefined {
  if (options?.apiKey) return options.apiKey;

  const envVar = process.env.WORKOS_API_KEY;
  if (envVar) return envVar;

  const activeEnv = getActiveEnvironment();
  if (activeEnv?.apiKey) return activeEnv.apiKey;

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
