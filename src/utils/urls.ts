/**
 * WorkOS service endpoint resolution. Env vars override defaults.
 *
 * WORKOS_API_URL is the single base host; the LLM gateway and CLI telemetry
 * endpoints are served under it and derived here. The trailing slash is
 * normalized at the source so every derived path stays clean.
 */

export const getWorkOSApiUrl = (): string =>
  (process.env.WORKOS_API_URL || 'https://api.workos.com').replace(/\/$/, '');

export const getWorkOSDashboardUrl = (): string =>
  process.env.WORKOS_DASHBOARD_URL || 'https://dashboard.workos.com';

/** LLM gateway endpoint, served under the WorkOS API host. */
export const getLlmGatewayUrl = (): string => `${getWorkOSApiUrl()}/llm-gateway`;

/** CLI telemetry endpoint, served under the WorkOS API host. */
export const getTelemetryUrl = (): string => `${getWorkOSApiUrl()}/cli`;
