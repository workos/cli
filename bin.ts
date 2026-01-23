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
  dashboard: {
    alias: 'd',
    default: false,
    describe: 'Run with visual dashboard mode',
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
    'install',
    'Install WorkOS AuthKit into your project',
    (yargs) => yargs.options(wizardOptions),
    async (argv) => {
      const { handleInstall } = await import('./src/commands/install.js');
      await handleInstall(argv);
    },
  )
  .command(
    'dashboard',
    false, // hidden from help
    (yargs) => yargs.options(wizardOptions),
    async (argv) => {
      const { handleInstall } = await import('./src/commands/install.js');
      await handleInstall({ ...argv, dashboard: true });
    },
  )
  .command(
    ['$0'],
    'WorkOS AuthKit CLI',
    (yargs) => yargs,
    async () => {
      // Non-TTY: show help
      if (isNonInteractiveEnvironment()) {
        yargs(hideBin(process.argv)).showHelp();
        return;
      }

      // TTY: show interactive menu
      const { showMenu } = await import('./src/commands/menu.js');
      clack.intro(chalk.inverse('WorkOS AuthKit Wizard'));
      const selection = await showMenu();

      // Dispatch to selected command
      switch (selection.command) {
        case 'install': {
          const { handleInstall } = await import('./src/commands/install.js');
          await handleInstall({ dashboard: false } as any);
          break;
        }
        case 'login': {
          const { runLogin } = await import('./src/commands/login.js');
          await runLogin();
          break;
        }
        case 'logout': {
          const { runLogout } = await import('./src/commands/logout.js');
          await runLogout();
          break;
        }
        case 'install-skill': {
          const { runInstallSkill } = await import('./src/commands/install-skill.js');
          await runInstallSkill({});
          break;
        }
      }
      process.exit(0);
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80).argv;
