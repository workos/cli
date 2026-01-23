import open from 'opn';
import clack from '../utils/clack.js';
import { saveCredentials, getCredentials, getAccessToken } from '../lib/credentials.js';
import { getCliAuthClientId, getAuthkitDomain } from '../lib/settings.js';
import { startDeviceAuth, DeviceAuthError } from '../lib/device-auth.js';

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

  try {
    const { deviceAuth, poll } = await startDeviceAuth({
      clientId,
      authkitDomain: getAuthkitDomain(),
    });

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

    const result = await poll();

    const expiresInSec = Math.round((result.expiresAt - Date.now()) / 1000);

    saveCredentials({
      accessToken: result.accessToken,
      expiresAt: result.expiresAt,
      userId: result.userId,
      email: result.email,
    });

    spinner.stop('Authentication successful!');
    clack.log.success(`Logged in as ${result.email || result.userId}`);
    clack.log.info(`Token expires in ${expiresInSec} seconds`);
  } catch (error) {
    if (error instanceof DeviceAuthError) {
      if (error.message.includes('timed out')) {
        clack.log.error('Authentication timed out. Please try again.');
      } else {
        clack.log.error(`Authentication error: ${error.message}`);
      }
    } else {
      clack.log.error(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
    process.exit(1);
  }
}
