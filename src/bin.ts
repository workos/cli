#!/usr/bin/env node

// Load .env.local for local development when --local flag is used
if (process.argv.includes('--local') || process.env.INSTALLER_DEV) {
  const { config } = await import('dotenv');
  // bin.ts compiles to dist/bin.js, so go up one level to find .env.local
  config({ path: new URL('../.env.local', import.meta.url).pathname });
}

import { satisfies } from 'semver';
import { red } from './utils/logging.js';
import { getConfig } from './lib/settings.js';

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { ensureAuthenticated } from './lib/ensure-auth.js';
import { checkForUpdates } from './lib/version-check.js';

const NODE_VERSION_RANGE = getConfig().nodeVersion;

// Have to run this above the other imports because they are importing clack that
// has the problematic imports.
if (!satisfies(process.version, NODE_VERSION_RANGE)) {
  red(
    `WorkOS AuthKit installer requires Node.js ${NODE_VERSION_RANGE}. You are using Node.js ${process.version}. Please upgrade your Node.js version.`,
  );
  process.exit(1);
}

import { isNonInteractiveEnvironment } from './utils/environment.js';
import clack from './utils/clack.js';

// Shared options for wizard commands (default and dashboard)
/**
 * Wrap a command handler with authentication check.
 * Ensures valid auth before executing the handler.
 * Respects --skip-auth flag for CI/testing.
 */
function withAuth<T>(handler: (argv: T) => Promise<void>): (argv: T) => Promise<void> {
  return async (argv: T) => {
    const typedArgv = argv as { skipAuth?: boolean; insecureStorage?: boolean };

    // Set storage mode before any auth operations
    if (typedArgv.insecureStorage) {
      const { setInsecureStorage } = await import('./lib/credentials.js');
      setInsecureStorage(true);
    }

    if (!typedArgv.skipAuth) {
      await ensureAuthenticated();
    }
    await handler(argv);
  };
}

const installerOptions = {
  direct: {
    alias: 'D',
    default: false,
    describe: 'Use your own Anthropic API key (bypass llm-gateway)',
    type: 'boolean' as const,
  },
  debug: {
    default: false,
    describe: 'Enable verbose logging',
    type: 'boolean' as const,
  },
  'insecure-storage': {
    default: false,
    describe: 'Store credentials in plaintext file instead of system keyring',
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

// Check for updates (blocks up to 500ms)
await checkForUpdates();

yargs(hideBin(process.argv))
  .env('WORKOS_INSTALLER')
  .command(
    'login',
    'Authenticate with WorkOS',
    {
      'insecure-storage': {
        default: false,
        describe: 'Store credentials in plaintext file instead of system keyring',
        type: 'boolean' as const,
      },
    },
    async (argv) => {
      if (argv.insecureStorage) {
        const { setInsecureStorage } = await import('./lib/credentials.js');
        setInsecureStorage(true);
      }
      const { runLogin } = await import('./commands/login.js');
      await runLogin();
      process.exit(0);
    },
  )
  .command(
    'logout',
    'Remove stored credentials',
    {
      'insecure-storage': {
        default: false,
        describe: 'Store credentials in plaintext file instead of system keyring',
        type: 'boolean' as const,
      },
    },
    async (argv) => {
      if (argv.insecureStorage) {
        const { setInsecureStorage } = await import('./lib/credentials.js');
        setInsecureStorage(true);
      }
      const { runLogout } = await import('./commands/logout.js');
      await runLogout();
    },
  )
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
    withAuth(async (argv) => {
      const { runInstallSkill } = await import('./commands/install-skill.js');
      await runInstallSkill({
        list: argv.list as boolean | undefined,
        skill: argv.skill as string[] | undefined,
        agent: argv.agent as string[] | undefined,
      });
    }),
  )
  .command(
    'install',
    'Install WorkOS AuthKit into your project',
    (yargs) => yargs.options(installerOptions),
    withAuth(async (argv) => {
      const { handleInstall } = await import('./commands/install.js');
      await handleInstall(argv);
    }),
  )
  .command(
    'dashboard',
    false, // hidden from help
    (yargs) => yargs.options(installerOptions),
    withAuth(async (argv) => {
      const { handleInstall } = await import('./commands/install.js');
      await handleInstall({ ...argv, dashboard: true });
    }),
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

      // TTY: ask if user wants to run installer
      const shouldInstall = await clack.confirm({
        message: 'Run the AuthKit installer?',
      });

      if (clack.isCancel(shouldInstall) || !shouldInstall) {
        process.exit(0);
      }

      // Auth check happens HERE, after user confirms
      await ensureAuthenticated();

      const { handleInstall } = await import('./commands/install.js');
      await handleInstall({ dashboard: false } as any);
      process.exit(0);
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .version()
  .alias('version', 'v')
  .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80).argv;
