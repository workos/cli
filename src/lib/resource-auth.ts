/**
 * Which credential an environment-scoped resource command (`organization`,
 * `user`, `role`, …) runs with: the dashboard session, or an API key.
 *
 * Precedence (first match wins):
 * 1. `--api-key` flag
 * 2. `WORKOS_API_KEY`
 * 3. the active profile's stored key, but ONLY when that profile is an
 *    unclaimed environment (a dashboard session can't reach an unclaimed
 *    environment, so its key is the only credential that works there)
 * 4. otherwise the existing dashboard-session path, unchanged
 *
 * A claimed profile's stored key never switches the path: signed-in users keep
 * today's behavior unless they pass a key explicitly. Resolution reuses
 * `resolveOptionalApiKey()` so these commands accept exactly the flag and env
 * var `workos api` and the still-REST commands do.
 *
 * Team-scoped account-plane commands (`team`, `project`, `environment`,
 * `whoami`) don't consult this module: they have no API-key equivalent.
 */

import { getActiveEnvironment, isUnclaimedEnvironment } from './config-store.js';
import { resolveApiBaseUrl, resolveOptionalApiKey } from './api-key.js';

export type ApiKeySource = 'flag' | 'env' | 'unclaimed-profile';

/**
 * Stand-in target for the API-key path, where the key itself selects the
 * environment and no dashboard environment ID is known. Internal only: it
 * keys per-environment state inside one invocation (feature-flag state) and
 * is never sent anywhere.
 */
export const API_KEY_ENVIRONMENT_ID = 'environment_of_api_key';

export interface ApiKeyAuth {
  kind: 'api-key';
  apiKey: string;
  baseUrl: string;
  source: ApiKeySource;
}

/**
 * The credential an operation runs with: a dashboard bearer token (string, the
 * long-standing shape every call site already passes) or an API key.
 */
export type OperationAuth = string | ApiKeyAuth;

export function isApiKeyAuth(auth: OperationAuth): auth is ApiKeyAuth {
  return typeof auth !== 'string';
}

let apiKeyFlag: string | undefined;

/**
 * Record the `--api-key` flag for this invocation. Set from a command-group
 * middleware in bin.ts, so every subcommand handler picks it up without
 * threading the value through each options object.
 */
export function setResourceApiKeyFlag(value: string | undefined): void {
  apiKeyFlag = typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * The API key this invocation should use, or `null` to stay on the dashboard
 * session path. See the module comment for the precedence rule.
 */
export function resolveResourceApiKey(): ApiKeyAuth | null {
  let source: ApiKeySource | undefined;
  if (apiKeyFlag) {
    source = 'flag';
  } else if (process.env.WORKOS_API_KEY) {
    source = 'env';
  } else {
    const active = getActiveEnvironment();
    if (active && isUnclaimedEnvironment(active) && active.apiKey) source = 'unclaimed-profile';
  }
  if (!source) return null;

  const apiKey = resolveOptionalApiKey({ apiKey: apiKeyFlag });
  if (!apiKey) return null;
  return { kind: 'api-key', apiKey, baseUrl: resolveApiBaseUrl(), source };
}
