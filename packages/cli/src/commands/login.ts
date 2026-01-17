import open from 'opn';
import clack from '../utils/clack.js';
import {
  saveCredentials,
  hasCredentials,
  getCredentials,
} from '../lib/credentials.js';

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
}

interface AuthErrorResponse {
  error: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLogin(): Promise<void> {
  const clientId = process.env.WORKOS_CLIENT_ID;

  if (!clientId) {
    clack.log.error('Missing WORKOS_CLIENT_ID in environment');
    process.exit(1);
  }

  // Check if already logged in
  if (hasCredentials()) {
    const creds = getCredentials();
    if (creds?.email) {
      clack.log.info(`Already logged in as ${creds.email}`);
      clack.log.info('Run `wizard logout` to log out');
      return;
    }
  }

  clack.log.step('Starting authentication...');

  // 1. Request device authorization
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

  // 2. Display instructions to user
  clack.log.info(`\nOpen this URL in your browser:\n`);
  console.log(`  ${deviceAuth.verification_uri}`);
  console.log(`\nEnter code: ${deviceAuth.user_code}\n`);

  // Try to open browser automatically
  try {
    await open(deviceAuth.verification_uri_complete);
    clack.log.info('Browser opened automatically');
  } catch {
    // Ignore - user can open manually
  }

  // 3. Poll for completion
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
        // Success!
        const result = data as AuthSuccessResponse;

        // Default to 15 minutes if not specified
        const expiresIn = 15 * 60;

        saveCredentials({
          accessToken: result.access_token,
          refreshToken: result.refresh_token,
          expiresAt: Date.now() + expiresIn * 1000,
          userId: result.user.id,
          email: result.user.email,
        });

        spinner.stop('Authentication successful!');
        clack.log.success(`Logged in as ${result.user.email}`);
        return;
      }

      // Handle error responses
      const errorData = data as AuthErrorResponse;

      if (errorData.error === 'authorization_pending') {
        // User hasn't completed auth yet, keep polling
        continue;
      }
      if (errorData.error === 'slow_down') {
        // Polling too fast, increase interval
        currentInterval += 5000;
        continue;
      }
      if (
        errorData.error === 'access_denied' ||
        errorData.error === 'expired_token'
      ) {
        spinner.stop('Authentication failed');
        clack.log.error(`Authentication error: ${errorData.error}`);
        process.exit(1);
      }

      // Unknown error
      spinner.stop('Authentication failed');
      clack.log.error(`Unexpected error: ${errorData.error}`);
      process.exit(1);
    } catch (error: unknown) {
      // Network error - continue polling
      continue;
    }
  }

  spinner.stop('Authentication timed out');
  clack.log.error('Authentication timed out. Please try again.');
  process.exit(1);
}
