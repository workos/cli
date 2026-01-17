import clack from '../utils/clack.js';
import {
  clearCredentials,
  hasCredentials,
  getCredentials,
} from '../lib/credentials.js';

export async function runLogout(): Promise<void> {
  if (!hasCredentials()) {
    clack.log.info('Not logged in');
    return;
  }

  const creds = getCredentials();
  clearCredentials();

  if (creds?.email) {
    clack.log.success(`Logged out from ${creds.email}`);
  } else {
    clack.log.success('Logged out successfully');
  }
}
