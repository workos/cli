#!/usr/bin/env node

// Load .env.local for local development when --local flag is used
if (process.argv.includes('--local') || process.env.INSTALLER_DEV) {
  const { config } = await import('dotenv');
  // bin.ts compiles to dist/bin.js, so go up one level to find .env.local
  config({ path: new URL('../.env.local', import.meta.url).pathname });
}

import { satisfies } from 'semver';
import { red } from './utils/logging.js';
import { getConfig, getVersion } from './lib/settings.js';

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

/** Apply insecure storage flag if set */
async function applyInsecureStorage(insecureStorage?: boolean): Promise<void> {
  if (insecureStorage) {
    const { setInsecureStorage } = await import('./lib/credentials.js');
    setInsecureStorage(true);
  }
}

/** Shared insecure-storage option for commands that access credentials */
const insecureStorageOption = {
  'insecure-storage': {
    default: false,
    describe: 'Store credentials in plaintext file instead of system keyring',
    type: 'boolean' as const,
  },
} as const;

/**
 * Wrap a command handler with authentication check.
 * Ensures valid auth before executing the handler.
 * Respects --skip-auth flag for CI/testing.
 */
function withAuth<T>(handler: (argv: T) => Promise<void>): (argv: T) => Promise<void> {
  return async (argv: T) => {
    const typedArgv = argv as { skipAuth?: boolean; insecureStorage?: boolean };
    await applyInsecureStorage(typedArgv.insecureStorage);
    if (!typedArgv.skipAuth) await ensureAuthenticated();
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
  ...insecureStorageOption,
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

const widgetsInstallerOptions = {
  direct: installerOptions.direct,
  debug: installerOptions.debug,
  ...insecureStorageOption,
  local: installerOptions.local,
  ci: installerOptions.ci,
  'skip-auth': installerOptions['skip-auth'],
  'api-key': installerOptions['api-key'],
  'client-id': installerOptions['client-id'],
  inspect: installerOptions.inspect,
  'no-validate': installerOptions['no-validate'],
  'install-dir': installerOptions['install-dir'],
  dashboard: installerOptions.dashboard,
  widget: {
    describe: 'Widget to install',
    choices: ['user-management', 'admin-portal-sso-connection', 'admin-portal-domain-verification'] as const,
    type: 'string' as const,
  },
  'widgets-entry': {
    describe: 'Create component, page, or both (default: both)',
    choices: ['page', 'component', 'both'] as const,
    default: 'both',
    type: 'string' as const,
  },
  'widgets-framework': {
    describe: 'Framework to use',
    choices: ['nextjs', 'react-router', 'tanstack-start', 'tanstack-router', 'vite'] as const,
    type: 'string' as const,
  },
  'widgets-path': {
    describe: 'Path for the widget component file',
    type: 'string' as const,
  },
  'widgets-page-path': {
    describe: 'Path for the widget page/route file',
    type: 'string' as const,
  },
};

// Check for updates (blocks up to 500ms)
await checkForUpdates();

yargs(hideBin(process.argv))
  .env('WORKOS_INSTALLER')
  .command('login', 'Authenticate with WorkOS', insecureStorageOption, async (argv) => {
    await applyInsecureStorage(argv.insecureStorage);
    const { runLogin } = await import('./commands/login.js');
    await runLogin();
    process.exit(0);
  })
  .command('logout', 'Remove stored credentials', insecureStorageOption, async (argv) => {
    await applyInsecureStorage(argv.insecureStorage);
    const { runLogout } = await import('./commands/logout.js');
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
    'doctor',
    'Diagnose WorkOS integration issues',
    (yargs) =>
      yargs.options({
        verbose: {
          type: 'boolean',
          default: false,
          description: 'Include additional diagnostic information',
        },
        'skip-api': {
          type: 'boolean',
          default: false,
          description: 'Skip API calls (offline mode)',
        },
        'install-dir': {
          type: 'string',
          default: process.cwd(),
          description: 'Project directory to analyze',
        },
        json: {
          type: 'boolean',
          default: false,
          description: 'Output report as JSON',
        },
        copy: {
          type: 'boolean',
          default: false,
          description: 'Copy report to clipboard',
        },
      }),
    async (argv) => {
      const { handleDoctor } = await import('./commands/doctor.js');
      await handleDoctor(argv);
    },
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
    'install widgets',
    'Install WorkOS Widgets into your project',
    (yargs) => yargs.options(widgetsInstallerOptions),
    withAuth(async (argv) => {
      const { handleInstallWidgets } = await import('./commands/install-widgets.js');
      await handleInstallWidgets(argv);
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
    (yargs) => yargs.options(insecureStorageOption),
    async (argv) => {
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
      await applyInsecureStorage(argv.insecureStorage);
      await ensureAuthenticated();

      const { handleInstall } = await import('./commands/install.js');
      await handleInstall({ dashboard: false } as any);
      process.exit(0);
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .version(getVersion())
  .alias('version', 'v')
  .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80).argv;
