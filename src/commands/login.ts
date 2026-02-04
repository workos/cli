import open from 'opn';
import clack from '../utils/clack.js';
import { saveCredentials, getCredentials, getAccessToken, isTokenExpired, updateTokens } from '../lib/credentials.js';
import { getCliAuthClientId, getAuthkitDomain } from '../lib/settings.js';
import { refreshAccessToken } from '../lib/token-refresh-client.js';

/**
 * Parse JWT payload
 */
function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
  } catch {
    return null;
  }
}

/**
 * Extract expiry time from JWT token
 */
function getJwtExpiry(token: string): number | null {
  const payload = parseJwt(token);
  if (!payload || typeof payload.exp !== 'number') return null;
  return payload.exp * 1000;
}

const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get Connect OAuth endpoints from AuthKit domain
 */
function getConnectEndpoints() {
  const domain = getAuthkitDomain();
  return {
    deviceAuthorization: `${domain}/oauth2/device_authorization`,
    token: `${domain}/oauth2/token`,
  };
}

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface ConnectTokenResponse {
  access_token: string;
  id_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

interface AuthErrorResponse {
  error: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLogin(): Promise<void> {
  const clientId = getCliAuthClientId();

  if (!clientId) {
    clack.log.error('CLI auth not configured. Set WORKOS_CLI_CLIENT_ID environment variable.');
    process.exit(1);
  }

  // Check if already logged in with valid token
  if (getAccessToken()) {
    const creds = getCredentials();
    clack.log.info(`Already logged in as ${creds?.email ?? 'unknown'}`);
    clack.log.info('Run `workos logout` to log out');
    return;
  }

  // Try to refresh if we have expired credentials with a refresh token
  const existingCreds = getCredentials();
  if (existingCreds?.refreshToken && isTokenExpired(existingCreds)) {
    try {
      const authkitDomain = getAuthkitDomain();
      const result = await refreshAccessToken(authkitDomain, clientId);
      if (result.accessToken && result.expiresAt) {
        updateTokens(result.accessToken, result.expiresAt, result.refreshToken);
        clack.log.info(`Already logged in as ${existingCreds.email ?? 'unknown'}`);
        clack.log.info('(Session refreshed)');
        clack.log.info('Run `workos logout` to log out');
        return;
      }
    } catch {
      // Refresh failed, proceed with fresh login
    }
  }

  clack.log.step('Starting authentication...');

  const endpoints = getConnectEndpoints();

  const authResponse = await fetch(endpoints.deviceAuthorization, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'openid email staging-environment:credentials:read offline_access',
    }),
  });

  if (!authResponse.ok) {
    clack.log.error(`Failed to start authentication: ${authResponse.status}`);
    process.exit(1);
  }

  const deviceAuth = (await authResponse.json()) as DeviceAuthResponse;
  const pollIntervalMs = (deviceAuth.interval || 5) * 1000;

  clack.log.info(`\nOpen this URL in your browser:\n`);
  console.log(`  ${deviceAuth.verification_uri}`);
  console.log(`\nEnter code: ${deviceAuth.user_code}\n`);

  try {
    open(deviceAuth.verification_uri_complete);
    clack.log.info('Browser opened automatically');
  } catch {
    // User can open manually
  }

  const spinner = clack.spinner();
  spinner.start('Waiting for authentication...');

  const startTime = Date.now();
  let currentInterval = pollIntervalMs;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    await sleep(currentInterval);

    try {
      const tokenResponse = await fetch(endpoints.token, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceAuth.device_code,
          client_id: clientId,
        }),
      });

      const data = await tokenResponse.json();

      if (tokenResponse.ok) {
        const result = data as ConnectTokenResponse;

        // Parse user info from id_token JWT
        const idTokenPayload = parseJwt(result.id_token);
        const userId = (idTokenPayload?.sub as string) || 'unknown';
        const email = (idTokenPayload?.email as string) || undefined;

        // Extract actual expiry from access token JWT, fallback to response or 15 min
        const jwtExpiry = getJwtExpiry(result.access_token);
        const expiresAt =
          jwtExpiry ?? (result.expires_in ? Date.now() + result.expires_in * 1000 : Date.now() + 15 * 60 * 1000);

        const expiresInSec = Math.round((expiresAt - Date.now()) / 1000);

        saveCredentials({
          accessToken: result.access_token,
          expiresAt,
          userId,
          email,
          refreshToken: result.refresh_token,
        });

        spinner.stop('Authentication successful!');
        clack.log.success(`Logged in as ${email || userId}`);
        clack.log.info(`Token expires in ${expiresInSec} seconds`);
        return;
      }

      const errorData = data as AuthErrorResponse;
      if (errorData.error === 'authorization_pending') continue;
      if (errorData.error === 'slow_down') {
        currentInterval += 5000;
        continue;
      }

      spinner.stop('Authentication failed');
      clack.log.error(`Authentication error: ${errorData.error}`);
      process.exit(1);
    } catch {
      continue;
    }
  }

  spinner.stop('Authentication timed out');
  clack.log.error('Authentication timed out. Please try again.');
  process.exit(1);
}
