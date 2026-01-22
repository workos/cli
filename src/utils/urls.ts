import { getLlmGatewayUrl } from '../lib/settings.js';

/**
 * Get URLs. Env vars override config defaults.
 */

export const getWorkOSApiUrl = () => process.env.WORKOS_API_URL || 'https://api.workos.com';

export const getWorkOSDashboardUrl = () => process.env.WORKOS_DASHBOARD_URL || 'https://dashboard.workos.com';

export const getLlmGatewayUrlFromHost = getLlmGatewayUrl;
