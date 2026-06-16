/**
 * Get URLs. Env vars override config defaults.
 *
 * WORKOS_API_URL is the single base host. The LLM gateway and CLI telemetry
 * URLs are derived from it in settings.ts.
 */

export const getWorkOSApiUrl = () => process.env.WORKOS_API_URL || 'https://api.workos.com';

export const getWorkOSDashboardUrl = () => process.env.WORKOS_DASHBOARD_URL || 'https://dashboard.workos.com';
