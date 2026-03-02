import { runInstaller } from '../run.js';
import type { InstallerArgs } from '../run.js';
import clack from '../utils/clack.js';
import chalk from 'chalk';
import { exitWithError, isJsonMode } from '../utils/output.js';
import type { ArgumentsCamelCase } from 'yargs';

/**
 * Handle install command execution.
 */
export async function handleInstall(argv: ArgumentsCamelCase<InstallerArgs>): Promise<void> {
  const options = { ...argv };

  // CI mode validation
  if (options.ci) {
    if (!options.apiKey) {
      exitWithError({ code: 'missing_args', message: 'CI mode requires --api-key (WorkOS API key sk_xxx)' });
    }
    if (!options.clientId) {
      exitWithError({ code: 'missing_args', message: 'CI mode requires --client-id (WorkOS Client ID client_xxx)' });
    }
    if (!options.installDir) {
      exitWithError({
        code: 'missing_args',
        message: 'CI mode requires --install-dir (directory to install WorkOS AuthKit in)',
      });
    }
  }

  try {
    await runInstaller(options);
    process.exit(0);
  } catch (err) {
    const { getLogFilePath } = await import('../utils/debug.js');
    const logPath = getLogFilePath();

    if (isJsonMode()) {
      exitWithError({
        code: 'installer_error',
        message: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    if (options.debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    if (logPath) {
      clack.log.info(`Debug logs: ${logPath}`);
    }
    process.exit(1);
  }
}
