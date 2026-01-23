import type { WizardOptions } from '../utils/types.js';
import { runWizard } from '../run.js';
import { isNonInteractiveEnvironment } from '../utils/environment.js';
import clack from '../utils/clack.js';
import chalk from 'chalk';
import type { ArgumentsCamelCase } from 'yargs';

interface InstallArgs {
  debug?: boolean;
  local?: boolean;
  ci?: boolean;
  skipAuth?: boolean;
  apiKey?: string;
  clientId?: string;
  inspect?: boolean;
  homepageUrl?: string;
  redirectUri?: string;
  noValidate?: boolean;
  installDir?: string;
  integration?: string;
  forceInstall?: boolean;
  dashboard?: boolean;
}

/**
 * Handle install command execution.
 */
export async function handleInstall(argv: ArgumentsCamelCase<InstallArgs>): Promise<void> {
  const options = { ...argv };

  // CI mode validation
  if (options.ci) {
    if (!options.apiKey) {
      clack.intro(chalk.inverse('WorkOS AuthKit Wizard'));
      clack.log.error('CI mode requires --api-key (WorkOS API key sk_xxx)');
      process.exit(1);
    }
    if (!options.clientId) {
      clack.intro(chalk.inverse('WorkOS AuthKit Wizard'));
      clack.log.error('CI mode requires --client-id (WorkOS Client ID client_xxx)');
      process.exit(1);
    }
    if (!options.installDir) {
      clack.intro(chalk.inverse('WorkOS AuthKit Wizard'));
      clack.log.error('CI mode requires --install-dir (directory to install WorkOS AuthKit in)');
      process.exit(1);
    }
  } else if (isNonInteractiveEnvironment()) {
    clack.intro(chalk.inverse('WorkOS AuthKit Wizard'));
    clack.log.error(
      'This installer requires an interactive terminal (TTY) to run.\n' +
        'It appears you are running in a non-interactive environment.\n' +
        'Please run the wizard in an interactive terminal.\n\n' +
        'For CI/CD environments, use --ci mode:\n' +
        '  wizard install --ci --api-key sk_xxx --client-id client_xxx',
    );
    process.exit(1);
  }

  try {
    await runWizard(options as unknown as WizardOptions);
    process.exit(0);
  } catch (err) {
    const { getLogFilePath } = await import('../utils/debug.js');
    const logPath = getLogFilePath();
    const errorMessage = err instanceof Error ? err.message : String(err);

    // Always show the error message
    clack.log.error(errorMessage);

    // Show stack trace in debug mode
    if (options.debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    if (logPath) {
      clack.log.info(`Debug logs: ${logPath}`);
    }
    process.exit(1);
  }
}
