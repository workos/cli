import type { ArgumentsCamelCase } from 'yargs';
import { isNonInteractiveEnvironment } from '../utils/environment.js';
import clack from '../utils/clack.js';
import chalk from 'chalk';
import { runWidgetsInstaller } from '../widgets/run-widgets.js';
import type { WidgetsInstallerOptions } from '../widgets/run-widgets.js';

interface InstallWidgetsArgs {
  debug?: boolean;
  local?: boolean;
  ci?: boolean;
  skipAuth?: boolean;
  apiKey?: string;
  clientId?: string;
  inspect?: boolean;
  noValidate?: boolean;
  installDir?: string;
  dashboard?: boolean;
  direct?: boolean;
  widget?: string;
  widgetsEntry?: string;
  widgetsFramework?: string;
  widgetsPath?: string;
  widgetsPagePath?: string;
}

export async function handleInstallWidgets(argv: ArgumentsCamelCase<InstallWidgetsArgs>): Promise<void> {
  const options = { ...argv };
  if (!options.installDir) {
    options.installDir = process.cwd();
  }

  if (options.ci) {
    if (!options.installDir) {
      clack.intro(chalk.inverse('WorkOS Widgets Installer'));
      clack.log.error('CI mode requires --install-dir (directory to install WorkOS Widgets in)');
      process.exit(1);
    }
  } else if (isNonInteractiveEnvironment()) {
    clack.intro(chalk.inverse('WorkOS Widgets Installer'));
    clack.log.error(
      'This installer requires an interactive terminal (TTY) to run.\n' +
        'It appears you are running in a non-interactive environment.\n' +
        'Please run the installer in an interactive terminal.\n\n' +
        'For CI/CD environments, use --ci mode.',
    );
    process.exit(1);
  }

  const installerOptions: WidgetsInstallerOptions = {
    debug: options.debug ?? false,
    local: options.local ?? false,
    ci: options.ci ?? false,
    skipAuth: options.skipAuth ?? false,
    apiKey: options.apiKey,
    clientId: options.clientId,
    inspect: options.inspect,
    noValidate: options.noValidate ?? false,
    installDir: options.installDir ?? process.cwd(),
    dashboard: options.dashboard ?? false,
    direct: options.direct ?? false,
    forceInstall: false,
    widget: options.widget as WidgetsInstallerOptions['widget'],
    widgetsEntry: options.widgetsEntry as WidgetsInstallerOptions['widgetsEntry'],
    widgetsFramework: options.widgetsFramework as WidgetsInstallerOptions['widgetsFramework'],
    widgetsPath: options.widgetsPath,
    widgetsPagePath: options.widgetsPagePath,
  };

  try {
    await runWidgetsInstaller(installerOptions);
    process.exit(0);
  } catch (err) {
    if (options.debug && err instanceof Error && err.stack) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}
