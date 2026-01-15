import { IS_DEV } from '../lib/constants';
import type { CloudRegion } from './types';

// WorkOS URLs (no region-specific logic needed)
export const getWorkOSApiUrl = () => {
  return IS_DEV ? 'http://localhost:8000' : 'https://api.workos.com';
};

export const getWorkOSDashboardUrl = () => {
  return IS_DEV ? 'http://localhost:3000' : 'https://dashboard.workos.com';
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

// FIXME: Update production URL once LLM gateway is deployed
export const getLlmGatewayUrlFromHost = (host: string) => {
  return IS_DEV ? 'http://localhost:8000' : 'https://llm-gateway.example.com';
};
