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

const DEFAULT_BASE_URL = 'https://api.workos.com';

export interface ApiKeyOptions {
  apiKey?: string;
}

export function resolveApiKey(options?: ApiKeyOptions): string {
  if (options?.apiKey) return options.apiKey;

  const envVar = process.env.WORKOS_API_KEY;
  if (envVar) return envVar;

  const activeEnv = getActiveEnvironment();
  if (activeEnv?.apiKey) return activeEnv.apiKey;

  exitWithError({
    code: 'no_api_key',
    message: 'No API key configured. Run `workos env add` to configure an environment, or set WORKOS_API_KEY.',
  });
}

export function resolveApiBaseUrl(): string {
  const activeEnv = getActiveEnvironment();
  return activeEnv?.endpoint || DEFAULT_BASE_URL;
}
