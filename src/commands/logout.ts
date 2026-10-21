import ui from '../utils/ui.js';
import { clearCredentials, hasCredentials, getCredentials } from '../lib/credentials.js';

export async function runLogout(): Promise<void> {
  if (!hasCredentials()) {
    ui.log.info('Not logged in');
    return;
  }

  const creds = getCredentials();
  clearCredentials();

  if (creds?.email) {
    ui.log.success(`Logged out from ${creds.email}`);
  } else {
    ui.log.success('Logged out successfully');
  }
}
