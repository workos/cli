import open from 'opn';
import clack from '../utils/clack.js';
import { saveCredentials, getCredentials, getAccessToken } from '../lib/credentials.js';
import { getCliAuthClientId } from '../lib/settings.js';

/**
 * Extract expiry time from JWT token
 */
function getJwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

const WORKOS_API_BASE = 'https://api.workos.com/user_management';
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

interface DeviceAuthResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

interface AuthSuccessResponse {
  user: {
    id: string;
    email: string;
  };
  access_token: string;
  refresh_token: string;
  expires_in?: number;
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

  if (getAccessToken()) {
    const creds = getCredentials();
    clack.log.info(`Already logged in as ${creds?.email ?? 'unknown'}`);
    clack.log.info('Run `wizard logout` to log out');
    return;
  }

  clack.log.step('Starting authentication...');

  const authResponse = await fetch(`${WORKOS_API_BASE}/authorize/device`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
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
      const tokenResponse = await fetch(`${WORKOS_API_BASE}/authenticate`, {
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
        const result = data as AuthSuccessResponse;

        // Extract actual expiry from JWT, fallback to response or 15 min
        const jwtExpiry = getJwtExpiry(result.access_token);
        const expiresAt =
          jwtExpiry ?? (result.expires_in ? Date.now() + result.expires_in * 1000 : Date.now() + 15 * 60 * 1000);

        const expiresInSec = Math.round((expiresAt - Date.now()) / 1000);

        // Only store access token - refresh tokens are not persisted for security
        // User will need to re-authenticate when token expires
        saveCredentials({
          accessToken: result.access_token,
          expiresAt,
          userId: result.user.id,
          email: result.user.email,
        });

        spinner.stop('Authentication successful!');
        clack.log.success(`Logged in as ${result.user.email}`);
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
