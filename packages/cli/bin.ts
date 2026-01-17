#!/usr/bin/env node
import { satisfies } from 'semver';
import { red } from './src/utils/logging.js';
import { getSettings } from './src/lib/settings.js';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

const NODE_VERSION_RANGE = getSettings().nodeVersion;

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `WorkOS AuthKit wizard requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

import type { WizardOptions } from './src/utils/types.js';
import { runWizard } from './src/run.js';
import { isNonInteractiveEnvironment } from './src/utils/environment.js';
import clack from './src/utils/clack.js';

// E2E tests removed - no mock server needed

yargs(hideBin(process.argv))
  .env('WORKOS_WIZARD')
  .options({})
  .command('login', 'Authenticate with WorkOS', {}, async () => {
    const { runLogin } = await import('./src/commands/login.js');
    await runLogin();
  })
  .command('logout', 'Remove stored credentials', {}, async () => {
    const { runLogout } = await import('./src/commands/logout.js');
    await runLogout();
  })
  .options({
    debug: {
      default: false,
      describe: 'Enable verbose logging\nenv: WORKOS_WIZARD_DEBUG',
      type: 'boolean',
    },
    default: {
      default: true,
      describe:
        'Use default options for all prompts\nenv: WORKOS_WIZARD_DEFAULT',
      type: 'boolean',
    },
    local: {
      default: false,
      describe:
        'Use local services (LLM gateway on localhost:8000)\nenv: WORKOS_WIZARD_LOCAL',
      type: 'boolean',
    },
    ci: {
      default: false,
      describe:
        'Enable CI mode for non-interactive execution\nenv: WORKOS_WIZARD_CI',
      type: 'boolean',
    },
    'api-key': {
      describe: 'WorkOS API key (sk_xxx)\nenv: WORKOS_WIZARD_API_KEY',
      type: 'string',
    },
    'client-id': {
      describe: 'WorkOS Client ID (client_xxx)\nenv: WORKOS_WIZARD_CLIENT_ID',
      type: 'string',
    },
    'homepage-url': {
      describe:
        'App homepage URL for WorkOS (defaults to http://localhost:{port})\nenv: WORKOS_WIZARD_HOMEPAGE_URL',
      type: 'string',
    },
    'redirect-uri': {
      describe:
        'Redirect URI for WorkOS callback (defaults to framework convention)\nenv: WORKOS_WIZARD_REDIRECT_URI',
      type: 'string',
    },
  })
  .command(
    ['$0'],
    'Run the WorkOS AuthKit setup wizard',
    (yargs) => {
      return yargs.options({
        'force-install': {
          default: false,
          describe:
            'Force install packages even if peer dependency checks fail\nenv: WORKOS_WIZARD_FORCE_INSTALL',
          type: 'boolean',
        },
        'install-dir': {
          describe:
            'Directory to install WorkOS AuthKit in\nenv: WORKOS_WIZARD_INSTALL_DIR',
          type: 'string',
        },
        integration: {
          describe: 'Integration to set up',
          choices: [
            'nextjs',
            'react',
            'tanstack-start',
            'react-router',
            'vanilla-js',
          ],
          type: 'string',
        },
      });
    },
    (argv) => {
      const options = { ...argv };

      // CI mode validation and TTY check
      if (options.ci) {
        // Validate required CI flags
        if (!options.apiKey) {
          clack.intro(chalk.inverse(`WorkOS AuthKit Wizard`));
          clack.log.error('CI mode requires --api-key (WorkOS API key sk_xxx)');
          process.exit(1);
        }
        if (!options.clientId) {
          clack.intro(chalk.inverse(`WorkOS AuthKit Wizard`));
          clack.log.error(
            'CI mode requires --client-id (WorkOS Client ID client_xxx)',
          );
          process.exit(1);
        }
        if (!options.installDir) {
          clack.intro(chalk.inverse(`WorkOS AuthKit Wizard`));
          clack.log.error(
            'CI mode requires --install-dir (directory to install WorkOS AuthKit in)',
          );
          process.exit(1);
        }
      } else if (isNonInteractiveEnvironment()) {
        // Original TTY error for non-CI mode
        clack.intro(chalk.inverse(`WorkOS AuthKit Wizard`));
        clack.log.error(
          'This installer requires an interactive terminal (TTY) to run.\n' +
            'It appears you are running in a non-interactive environment.\n' +
            'Please run the wizard in an interactive terminal.\n\n' +
            'For CI/CD environments, use --ci mode:\n' +
            '  npx @workos/authkit-wizard --ci --api-key sk_xxx --client-id client_xxx',
        );
        process.exit(1);
      }

      void runWizard(options as unknown as WizardOptions);
    },
  )
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(
    process.stdout.isTTY && process.stdout.columns
      ? process.stdout.columns
      : 80,
  ).argv;
