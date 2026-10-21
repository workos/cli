import { resolveApiBaseUrl } from '../lib/api-key.js';

/**
 * WorkOS service endpoint resolution. Env vars override defaults.
 *
 * The API base host is resolved once in `lib/api-key.ts` (`resolveApiBaseUrl`:
 * the WORKOS_API_URL -> WORKOS_API_BASE_URL -> active profile -> default
 * chokepoint). The LLM gateway and CLI telemetry endpoints derive from it here,
 * so they always follow the same host as every other CLI request. Do not read
 * WORKOS_API_URL directly here -- that reintroduces a second reader that ignores
 * the alias and the active profile.
 */

export const getWorkOSApiUrl = (): string => resolveApiBaseUrl().replace(/\/+$/, '');

/** LLM gateway endpoint, served under the WorkOS API host. */
export const getLlmGatewayUrl = (): string => `${getWorkOSApiUrl()}/llm-gateway`;

/** CLI telemetry endpoint, served under the WorkOS API host. */
export const getTelemetryUrl = (): string => `${getWorkOSApiUrl()}/cli`;

export const getWorkOSDashboardUrl = (): string => process.env.WORKOS_DASHBOARD_URL || 'https://dashboard.workos.com';
