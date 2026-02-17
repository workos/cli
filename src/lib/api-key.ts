/**
 * API key resolution for management commands.
 *
 * Priority chain:
 * 1. WORKOS_API_KEY environment variable
 * 2. --api-key flag
 * 3. Active environment's stored API key
 */

import { getActiveEnvironment } from './config-store.js';

const DEFAULT_BASE_URL = 'https://api.workos.com';

export interface ApiKeyOptions {
  apiKey?: string;
}

export function resolveApiKey(options?: ApiKeyOptions): string {
  const envVar = process.env.WORKOS_API_KEY;
  if (envVar) return envVar;

  if (options?.apiKey) return options.apiKey;

  const activeEnv = getActiveEnvironment();
  if (activeEnv?.apiKey) return activeEnv.apiKey;

  throw new Error('No API key configured. Run `workos env add` to configure an environment, or set WORKOS_API_KEY.');
}

export function resolveApiBaseUrl(): string {
  const activeEnv = getActiveEnvironment();
  return activeEnv?.endpoint || DEFAULT_BASE_URL;
}
