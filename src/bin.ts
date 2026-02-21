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
import type { ArgumentsCamelCase } from 'yargs';
import type { InstallArgs } from './commands/install.js';

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
    const { setInsecureConfigStorage } = await import('./lib/config-store.js');
    setInsecureStorage(true);
    setInsecureConfigStorage(true);
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
        'skip-ai': {
          type: 'boolean',
          default: false,
          description: 'Skip AI-powered analysis',
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
  .command('env', 'Manage environment configurations', (yargs) =>
    yargs
      .options(insecureStorageOption)
      .command(
        'add [name] [apiKey]',
        'Add an environment configuration',
        (yargs) =>
          yargs
            .positional('name', { type: 'string', describe: 'Environment name' })
            .positional('apiKey', { type: 'string', describe: 'WorkOS API key' })
            .option('client-id', { type: 'string', describe: 'WorkOS client ID' })
            .option('endpoint', { type: 'string', describe: 'Custom API endpoint' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvAdd } = await import('./commands/env.js');
          await runEnvAdd({
            name: argv.name,
            apiKey: argv.apiKey,
            clientId: argv.clientId,
            endpoint: argv.endpoint,
          });
        },
      )
      .command(
        'remove <name>',
        'Remove an environment configuration',
        (yargs) => yargs.positional('name', { type: 'string', demandOption: true, describe: 'Environment name' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvRemove } = await import('./commands/env.js');
          await runEnvRemove(argv.name);
        },
      )
      .command(
        'switch [name]',
        'Switch active environment',
        (yargs) => yargs.positional('name', { type: 'string', describe: 'Environment name' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvSwitch } = await import('./commands/env.js');
          await runEnvSwitch(argv.name);
        },
      )
      .command('list', 'List configured environments', {}, async (argv) => {
        const typedArgv = argv as { insecureStorage?: boolean };
        await applyInsecureStorage(typedArgv.insecureStorage);
        const { runEnvList } = await import('./commands/env.js');
        await runEnvList();
      })
      .demandCommand(1, 'Please specify an env subcommand')
      .strict(),
  )
  .command('organization', 'Manage organizations', (yargs) =>
    yargs
      .options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key (overrides environment config)' },
      })
      .command(
        'create <name> [domains..]',
        'Create a new organization',
        (yargs) =>
          yargs
            .positional('name', { type: 'string', demandOption: true, describe: 'Organization name' })
            .positional('domains', { type: 'string', array: true, describe: 'Domains as domain:state' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgCreate } = await import('./commands/organization.js');
          const apiKey = resolveApiKey({ apiKey: argv.apiKey });
          await runOrgCreate(argv.name, (argv.domains as string[]) || [], apiKey, resolveApiBaseUrl());
        },
      )
      .command(
        'update <orgId> <name> [domain] [state]',
        'Update an organization',
        (yargs) =>
          yargs
            .positional('orgId', { type: 'string', demandOption: true, describe: 'Organization ID' })
            .positional('name', { type: 'string', demandOption: true, describe: 'Organization name' })
            .positional('domain', { type: 'string', describe: 'Domain' })
            .positional('state', { type: 'string', describe: 'Domain state (verified or pending)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgUpdate } = await import('./commands/organization.js');
          const apiKey = resolveApiKey({ apiKey: argv.apiKey });
          await runOrgUpdate(argv.orgId, argv.name, apiKey, argv.domain, argv.state, resolveApiBaseUrl());
        },
      )
      .command(
        'get <orgId>',
        'Get an organization by ID',
        (yargs) => yargs.positional('orgId', { type: 'string', demandOption: true, describe: 'Organization ID' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgGet } = await import('./commands/organization.js');
          const apiKey = resolveApiKey({ apiKey: argv.apiKey });
          await runOrgGet(argv.orgId, apiKey, resolveApiBaseUrl());
        },
      )
      .command(
        'list',
        'List organizations',
        (yargs) =>
          yargs.options({
            domain: { type: 'string', describe: 'Filter by domain' },
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            order: { type: 'string', describe: 'Order of results (asc or desc)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgList } = await import('./commands/organization.js');
          const apiKey = resolveApiKey({ apiKey: argv.apiKey });
          await runOrgList(
            { domain: argv.domain, limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            apiKey,
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'delete <orgId>',
        'Delete an organization',
        (yargs) => yargs.positional('orgId', { type: 'string', demandOption: true, describe: 'Organization ID' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDelete } = await import('./commands/organization.js');
          const apiKey = resolveApiKey({ apiKey: argv.apiKey });
          await runOrgDelete(argv.orgId, apiKey, resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify an organization subcommand')
      .strict(),
  )
  .command('user', 'Manage users', (yargs) =>
    yargs
      .options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key (overrides environment config)' },
      })
      .command(
        'get <userId>',
        'Get a user by ID',
        (yargs) => yargs.positional('userId', { type: 'string', demandOption: true, describe: 'User ID' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runUserGet } = await import('./commands/user.js');
          await runUserGet(argv.userId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'list',
        'List users',
        (yargs) =>
          yargs.options({
            email: { type: 'string', describe: 'Filter by email' },
            organization: { type: 'string', describe: 'Filter by organization ID' },
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            order: { type: 'string', describe: 'Order of results (asc or desc)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runUserList } = await import('./commands/user.js');
          await runUserList(
            {
              email: argv.email,
              organization: argv.organization,
              limit: argv.limit,
              before: argv.before,
              after: argv.after,
              order: argv.order,
            },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'update <userId>',
        'Update a user',
        (yargs) =>
          yargs.positional('userId', { type: 'string', demandOption: true, describe: 'User ID' }).options({
            'first-name': { type: 'string', describe: 'First name' },
            'last-name': { type: 'string', describe: 'Last name' },
            'email-verified': { type: 'boolean', describe: 'Email verification status' },
            password: { type: 'string', describe: 'New password' },
            'external-id': { type: 'string', describe: 'External ID' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runUserUpdate } = await import('./commands/user.js');
          await runUserUpdate(
            argv.userId,
            resolveApiKey({ apiKey: argv.apiKey }),
            {
              firstName: argv.firstName,
              lastName: argv.lastName,
              emailVerified: argv.emailVerified,
              password: argv.password,
              externalId: argv.externalId,
            },
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'delete <userId>',
        'Delete a user',
        (yargs) => yargs.positional('userId', { type: 'string', demandOption: true, describe: 'User ID' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runUserDelete } = await import('./commands/user.js');
          await runUserDelete(argv.userId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify a user subcommand')
      .strict(),
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
      await handleInstall({ dashboard: false } as ArgumentsCamelCase<InstallArgs>);
      process.exit(0);
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .version(getVersion())
  .alias('version', 'v')
  .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80).argv;
