import type { EnvironmentInfo } from '../types.js';

export function checkEnvironment(): EnvironmentInfo {
  const apiKey = process.env.WORKOS_API_KEY;
  const clientId = process.env.WORKOS_CLIENT_ID;
  const redirectUri = process.env.WORKOS_REDIRECT_URI;
  const cookieDomain = process.env.WORKOS_COOKIE_DOMAIN;
  const baseUrl = process.env.WORKOS_BASE_URL;

  return {
    apiKeyConfigured: !!apiKey,
    apiKeyType: getApiKeyType(apiKey),
    clientId: truncateClientId(clientId),
    redirectUri: redirectUri ?? null,
    cookieDomain: cookieDomain ?? null,
    baseUrl: baseUrl ?? 'https://api.workos.com',
  };
}

function getApiKeyType(apiKey: string | undefined): 'staging' | 'production' | null {
  if (!apiKey) return null;
  if (apiKey.startsWith('sk_test_')) return 'staging';
  if (apiKey.startsWith('sk_live_')) return 'production';
  return null; // Unknown format
}

function truncateClientId(clientId: string | undefined): string | null {
  if (!clientId) return null;
  if (clientId.length <= 15) return clientId;
  return `${clientId.slice(0, 10)}...${clientId.slice(-3)}`;
}
