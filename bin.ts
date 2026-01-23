#!/usr/bin/env node

// Load .env.local for local development when --local flag is used
if (process.argv.includes('--local') || process.env.WIZARD_DEV) {
  const { config } = await import('dotenv');
  // bin.ts compiles to dist/bin.js, so go up one level to find .env.local
  config({ path: new URL('../.env.local', import.meta.url).pathname });
}

import { satisfies } from 'semver';
import { red } from './src/utils/logging.js';
import { getConfig } from './src/lib/settings.js';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';

const NODE_VERSION_RANGE = getConfig().nodeVersion;

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

// Shared options for wizard commands (default and dashboard)
const wizardOptions = {
  debug: {
    default: false,
    describe: 'Enable verbose logging',
    type: 'boolean' as const,
  },
  // Hidden dev/automation flags (use env vars)
  local: {
    default: false,
    type: 'boolean' as const,
    hidden: true,
  },
  ci: {
    default: false,
    type: 'boolean' as const,
    hidden: true,
  },
  'skip-auth': {
    default: false,
    type: 'boolean' as const,
    hidden: true,
  },
  'api-key': {
    type: 'string' as const,
    hidden: true,
  },
  'client-id': {
    type: 'string' as const,
    hidden: true,
  },
  inspect: {
    default: false,
    type: 'boolean' as const,
    hidden: true,
  },
  // User-facing flags
  'homepage-url': {
    describe: 'App homepage URL for WorkOS (defaults to http://localhost:{port})',
    type: 'string' as const,
  },
  'redirect-uri': {
    describe: 'Redirect URI for WorkOS callback (defaults to framework convention)',
    type: 'string' as const,
  },
  'no-validate': {
    default: false,
    describe: 'Skip post-installation validation (includes build check)',
    type: 'boolean' as const,
  },
  'install-dir': {
    describe: 'Directory to install WorkOS AuthKit in',
    type: 'string' as const,
  },
  integration: {
    describe: 'Integration to set up',
    choices: ['nextjs', 'react', 'tanstack-start', 'react-router', 'vanilla-js'] as const,
    type: 'string' as const,
  },
  'force-install': {
    default: false,
    describe: 'Force install packages even if peer dependency checks fail',
    type: 'boolean' as const,
  },
};

yargs(hideBin(process.argv))
  .env('WORKOS_WIZARD')
  .command('login', 'Authenticate with WorkOS', {}, async () => {
    const { runLogin } = await import('./src/commands/login.js');
    await runLogin();
    process.exit(0);
  })
  .command('logout', 'Remove stored credentials', {}, async () => {
    const { runLogout } = await import('./src/commands/logout.js');
    await runLogout();
  })
  .command(
    'install-skill',
    'Install bundled AuthKit skills to coding agents',
    (yargs) => {
      return yargs
        .option('list', {
          alias: 'l',
          type: 'boolean',
          description: 'List available skills without installing',
        })
        .option('skill', {
          alias: 's',
          type: 'array',
          string: true,
          description: 'Install specific skill(s)',
        })
        .option('agent', {
          alias: 'a',
          type: 'array',
          string: true,
          description: 'Target specific agent(s): claude-code, codex, cursor, goose',
        });
    },
    async (argv) => {
      const { runInstallSkill } = await import('./src/commands/install-skill.js');
      await runInstallSkill({
        list: argv.list as boolean | undefined,
        skill: argv.skill as string[] | undefined,
        agent: argv.agent as string[] | undefined,
      });
    },
  )
  .command(
    'dashboard',
    '[Experimental] Run the wizard with visual dashboard mode',
    (yargs) => {
      return yargs.options(wizardOptions);
    },
    (argv) => {
      const options = { ...argv, dashboard: true };
      void import('./src/run.js').then(({ runWizard }) =>
        runWizard(options as unknown as WizardOptions)
          .then(() => process.exit(0))
          .catch(async (err) => {
            const { getLogFilePath } = await import('./src/utils/debug.js');
            const logPath = getLogFilePath();
            if (argv.debug) {
              console.error('\nWizard failed with error:');
              console.error(err instanceof Error ? err.stack || err.message : String(err));
            }
            if (logPath) {
              console.error(`\nSee debug logs at: ${logPath}`);
            }
            process.exit(1);
          }),
      );
    },
  )
  .command(
    ['$0'],
    'Run the WorkOS AuthKit setup wizard',
    (yargs) => {
      return yargs.options(wizardOptions);
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
          clack.log.error('CI mode requires --client-id (WorkOS Client ID client_xxx)');
          process.exit(1);
        }
        if (!options.installDir) {
          clack.intro(chalk.inverse(`WorkOS AuthKit Wizard`));
          clack.log.error('CI mode requires --install-dir (directory to install WorkOS AuthKit in)');
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

      void runWizard(options as unknown as WizardOptions)
        .then(() => process.exit(0))
        .catch(async (err) => {
          const { getLogFilePath } = await import('./src/utils/debug.js');
          const logPath = getLogFilePath();
          if (options.debug) {
            console.error('\nWizard failed with error:');
            console.error(err instanceof Error ? err.stack || err.message : String(err));
          }
          if (logPath) {
            console.error(`\nSee debug logs at: ${logPath}`);
          }
          process.exit(1);
        });
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80).argv;
