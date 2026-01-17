import { IS_DEV } from '../lib/constants.js';
import type { CloudRegion } from './types.js';
import { getSettings } from '../lib/settings.js';

// WorkOS URLs (no region-specific logic needed)
export const getWorkOSApiUrl = () => {
  const settings = getSettings();
  return IS_DEV ? settings.api.workos.development : settings.api.workos.production;
};

export const getWorkOSDashboardUrl = () => {
  const settings = getSettings();
  return IS_DEV ? settings.api.dashboard.development : settings.api.dashboard.production;
};

// Legacy functions - unused stubs for compatibility
export const getHostFromRegion = (region: CloudRegion) => {
  return getWorkOSApiUrl();
};

export const getCloudUrlFromRegion = (region: CloudRegion) => {
  return getWorkOSDashboardUrl();
};

export const getOauthClientIdFromRegion = (region: CloudRegion) => {
  return 'workos-oauth-client-id'; // Stub - OAuth not used
};

export const getLlmGatewayUrlFromHost = (host: string) => {
  const settings = getSettings();
  return IS_DEV ? settings.gateway.development : settings.gateway.production;
};
