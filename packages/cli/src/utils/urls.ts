import { IS_DEV } from '../lib/constants.js';
import type { CloudRegion } from './types.js';
import { getSettings } from '../lib/settings.js';

const settings = getSettings();

export const getWorkOSApiUrl = () =>
  IS_DEV ? settings.api.workos.development : settings.api.workos.production;

export const getWorkOSDashboardUrl = () =>
  IS_DEV ? settings.api.dashboard.development : settings.api.dashboard.production;

export const getHostFromRegion = (region: CloudRegion) => getWorkOSApiUrl();

export const getCloudUrlFromRegion = (region: CloudRegion) => getWorkOSDashboardUrl();

export const getOauthClientIdFromRegion = (region: CloudRegion) =>
  'workos-oauth-client-id';

export const getLlmGatewayUrlFromHost = () =>
  IS_DEV ? settings.gateway.development : settings.gateway.production;
