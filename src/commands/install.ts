import { runInstaller } from '../run.js';
import type { InstallerArgs } from '../run.js';
import clack from '../utils/clack.js';
import chalk from 'chalk';
import type { ArgumentsCamelCase } from 'yargs';

/**
 * Handle install command execution.
 */
export async function handleInstall(argv: ArgumentsCamelCase<InstallerArgs>): Promise<void> {
  const options = { ...argv };

  // CI mode validation
  if (options.ci) {
    if (!options.apiKey) {
      clack.intro(chalk.inverse('WorkOS AuthKit Installer'));
      clack.log.error('CI mode requires --api-key (WorkOS API key sk_xxx)');
      process.exit(1);
    }
    if (!options.clientId) {
      clack.intro(chalk.inverse('WorkOS AuthKit Installer'));
      clack.log.error('CI mode requires --client-id (WorkOS Client ID client_xxx)');
      process.exit(1);
    }
    if (!options.installDir) {
      clack.intro(chalk.inverse('WorkOS AuthKit Installer'));
      clack.log.error('CI mode requires --install-dir (directory to install WorkOS AuthKit in)');
      process.exit(1);
    }
  }

  try {
    await runInstaller(options);
    process.exit(0);
  } catch (err) {
    const { getLogFilePath } = await import('../utils/debug.js');
    const logPath = getLogFilePath();

    if (options.debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    if (logPath) {
      clack.log.info(`Debug logs: ${logPath}`);
    }
    process.exit(1);
  }
}
