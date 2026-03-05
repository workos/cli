import chalk from 'chalk';
import { getCredentials, isTokenExpired } from '../lib/credentials.js';
import { getActiveEnvironment } from '../lib/config-store.js';
import { isJsonMode, outputJson } from '../utils/output.js';

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return 'expired';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

export async function runAuthStatus(): Promise<void> {
  const creds = getCredentials();
  const activeEnv = getActiveEnvironment();

  if (!creds) {
    if (isJsonMode()) {
      outputJson({ authenticated: false });
      return;
    }
    console.log(chalk.yellow('Not logged in'));
    console.log(chalk.dim('Run `workos auth login` to authenticate'));
    return;
  }

  const expired = isTokenExpired(creds);
  const timeRemaining = creds.expiresAt - Date.now();

  if (isJsonMode()) {
    outputJson({
      authenticated: true,
      email: creds.email ?? null,
      userId: creds.userId,
      tokenExpired: expired,
      tokenExpiresAt: new Date(creds.expiresAt).toISOString(),
      tokenExpiresIn: expired ? null : formatTimeRemaining(timeRemaining),
      hasRefreshToken: !!creds.refreshToken,
      activeEnvironment: activeEnv ? { name: activeEnv.name, type: activeEnv.type } : null,
    });
    return;
  }

  console.log(chalk.green(`Logged in as ${creds.email ?? creds.userId}`));

  if (expired) {
    console.log(chalk.yellow(`Token expired ${formatTimeRemaining(-timeRemaining)} ago`));
  } else {
    console.log(chalk.dim(`Token expires in ${formatTimeRemaining(timeRemaining)}`));
  }

  console.log(chalk.dim(`Refresh token: ${creds.refreshToken ? 'present' : 'absent'}`));

  if (activeEnv) {
    console.log(chalk.dim(`Environment: ${activeEnv.name} (${activeEnv.type})`));
  }
}
