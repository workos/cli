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
import { resolveOutputMode, setOutputMode, outputJson, exitWithError } from './utils/output.js';
import clack from './utils/clack.js';

// Resolve output mode early from raw argv (before yargs parses)
const rawArgs = hideBin(process.argv);
const hasJsonFlag = rawArgs.includes('--json');
setOutputMode(resolveOutputMode(hasJsonFlag));

// Intercept --help --json before yargs parses (yargs exits on --help)
if (hasJsonFlag && (rawArgs.includes('--help') || rawArgs.includes('-h'))) {
  const { buildCommandTree } = await import('./utils/help-json.js');
  const commandAliases: Record<string, string> = { org: 'organization' };
  const rawCommand = rawArgs.find((a) => !a.startsWith('-'));
  const command = rawCommand ? (commandAliases[rawCommand] ?? rawCommand) : undefined;
  outputJson(buildCommandTree(command));
  process.exit(0);
}

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
    describe: 'WorkOS API key (required in non-interactive mode)',
  },
  'client-id': {
    type: 'string' as const,
    describe: 'WorkOS client ID (required in non-interactive mode)',
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
  validate: {
    default: true,
    describe: 'Run post-installation validation (use --no-validate to skip)',
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
  branch: {
    default: true,
    describe: 'Create a new branch for changes (use --no-branch to skip)',
    type: 'boolean' as const,
  },
  commit: {
    default: true,
    describe: 'Auto-commit after installation (use --no-commit to skip)',
    type: 'boolean' as const,
  },
  'create-pr': {
    default: false,
    describe: 'Auto-create pull request after installation',
    type: 'boolean' as const,
  },
  'git-check': {
    default: true,
    describe: 'Check for dirty working tree (use --no-git-check to skip)',
    type: 'boolean' as const,
  },
};

// Check for updates (blocks up to 500ms)
await checkForUpdates();

yargs(rawArgs)
  .env('WORKOS_INSTALLER')
  .option('json', {
    type: 'boolean',
    default: false,
    describe: 'Output results as JSON (auto-enabled in non-TTY)',
    global: true,
  })
  .command('login', 'Authenticate with WorkOS via browser-based OAuth', insecureStorageOption, async (argv) => {
    await applyInsecureStorage(argv.insecureStorage);
    const { runLogin } = await import('./commands/login.js');
    await runLogin();
    process.exit(0);
  })
  .command('logout', 'Remove stored WorkOS credentials and tokens', insecureStorageOption, async (argv) => {
    await applyInsecureStorage(argv.insecureStorage);
    const { runLogout } = await import('./commands/logout.js');
    await runLogout();
  })
  .command(
    'install-skill',
    'Install bundled AuthKit skills to coding agents (Claude Code, Codex, Cursor, Goose)',
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
    'Diagnose WorkOS AuthKit integration issues in the current project',
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
  // NOTE: When adding commands here, also update src/utils/help-json.ts
  .command('env', 'Manage environment configurations (API keys, endpoints, active environment)', (yargs) =>
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
          if (!argv.name && isNonInteractiveEnvironment()) {
            exitWithError({
              code: 'missing_args',
              message: 'Environment name required. Usage: workos env switch <name>',
            });
          }
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvSwitch } = await import('./commands/env.js');
          await runEnvSwitch(argv.name);
        },
      )
      .command(
        'list',
        'List configured environments',
        (yargs) => yargs,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvList } = await import('./commands/env.js');
          await runEnvList();
        },
      )
      .demandCommand(1, 'Please specify an env subcommand')
      .strict(),
  )
  .command(['organization', 'org'], 'Manage WorkOS organizations (create, update, get, list, delete)', (yargs) =>
    yargs
      .options({
        ...insecureStorageOption,
        'api-key': {
          type: 'string' as const,
          describe: 'WorkOS API key (overrides environment config). Format: sk_live_* or sk_test_*',
        },
      })
      .command(
        'create <name> [domains..]',
        'Create a new organization with optional verified domains',
        (yargs) =>
          yargs
            .positional('name', { type: 'string', demandOption: true, describe: 'Organization name' })
            .positional('domains', {
              type: 'string',
              array: true,
              describe: 'Domains in format domain:state (state defaults to verified)',
            }),
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
  .command('user', 'Manage WorkOS users (get, list, update, delete)', (yargs) =>
    yargs
      .options({
        ...insecureStorageOption,
        'api-key': {
          type: 'string' as const,
          describe: 'WorkOS API key (overrides environment config). Format: sk_live_* or sk_test_*',
        },
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
  // --- Resource Management Commands ---
  .command('role', 'Manage WorkOS roles (environment and organization-scoped)', (yargs) =>
    yargs
      .options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
        org: { type: 'string' as const, describe: 'Organization ID (for org-scoped roles)' },
      })
      .command(
        'list',
        'List roles',
        (yargs) => yargs,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleList } = await import('./commands/role.js');
          await runRoleList(argv.org, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'get <slug>',
        'Get a role by slug',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleGet } = await import('./commands/role.js');
          await runRoleGet(argv.slug, argv.org, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create',
        'Create a role',
        (yargs) =>
          yargs.options({
            slug: { type: 'string', demandOption: true, describe: 'Role slug' },
            name: { type: 'string', demandOption: true, describe: 'Role name' },
            description: { type: 'string', describe: 'Role description' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleCreate } = await import('./commands/role.js');
          await runRoleCreate(
            { slug: argv.slug, name: argv.name, description: argv.description },
            argv.org,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'update <slug>',
        'Update a role',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .options({ name: { type: 'string' }, description: { type: 'string' } }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleUpdate } = await import('./commands/role.js');
          await runRoleUpdate(
            argv.slug,
            { name: argv.name, description: argv.description },
            argv.org,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'delete <slug>',
        'Delete an org-scoped role (requires --org)',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }).demandOption('org'),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleDelete } = await import('./commands/role.js');
          await runRoleDelete(argv.slug, argv.org!, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'set-permissions <slug>',
        'Set all permissions on a role (replaces existing)',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .option('permissions', {
              type: 'string',
              demandOption: true,
              describe: 'Comma-separated permission slugs',
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleSetPermissions } = await import('./commands/role.js');
          await runRoleSetPermissions(
            argv.slug,
            argv.permissions.split(','),
            argv.org,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'add-permission <slug> <permissionSlug>',
        'Add a permission to a role',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .positional('permissionSlug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleAddPermission } = await import('./commands/role.js');
          await runRoleAddPermission(
            argv.slug,
            argv.permissionSlug,
            argv.org,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'remove-permission <slug> <permissionSlug>',
        'Remove a permission from an org role (requires --org)',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .positional('permissionSlug', { type: 'string', demandOption: true })
            .demandOption('org'),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runRoleRemovePermission } = await import('./commands/role.js');
          await runRoleRemovePermission(
            argv.slug,
            argv.permissionSlug,
            argv.org!,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .demandCommand(1, 'Please specify a role subcommand')
      .strict(),
  )
  .command('permission', 'Manage WorkOS permissions', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List permissions',
        (yargs) =>
          yargs.options({
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runPermissionList } = await import('./commands/permission.js');
          await runPermissionList(
            { limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'get <slug>',
        'Get a permission',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runPermissionGet } = await import('./commands/permission.js');
          await runPermissionGet(argv.slug, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create',
        'Create a permission',
        (yargs) =>
          yargs.options({
            slug: { type: 'string', demandOption: true },
            name: { type: 'string', demandOption: true },
            description: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runPermissionCreate } = await import('./commands/permission.js');
          await runPermissionCreate(
            { slug: argv.slug, name: argv.name, description: argv.description },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'update <slug>',
        'Update a permission',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .options({ name: { type: 'string' }, description: { type: 'string' } }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runPermissionUpdate } = await import('./commands/permission.js');
          await runPermissionUpdate(
            argv.slug,
            { name: argv.name, description: argv.description },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'delete <slug>',
        'Delete a permission',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runPermissionDelete } = await import('./commands/permission.js');
          await runPermissionDelete(argv.slug, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify a permission subcommand')
      .strict(),
  )
  .command('membership', 'Manage organization memberships', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List memberships',
        (yargs) =>
          yargs.options({
            org: { type: 'string' },
            user: { type: 'string' },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipList } = await import('./commands/membership.js');
          await runMembershipList(
            {
              org: argv.org,
              user: argv.user,
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
        'get <id>',
        'Get a membership',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipGet } = await import('./commands/membership.js');
          await runMembershipGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create',
        'Create a membership',
        (yargs) =>
          yargs.options({
            org: { type: 'string', demandOption: true },
            user: { type: 'string', demandOption: true },
            role: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipCreate } = await import('./commands/membership.js');
          await runMembershipCreate(
            { org: argv.org, user: argv.user, role: argv.role },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'update <id>',
        'Update a membership',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }).option('role', { type: 'string' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipUpdate } = await import('./commands/membership.js');
          await runMembershipUpdate(argv.id, argv.role, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'delete <id>',
        'Delete a membership',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipDelete } = await import('./commands/membership.js');
          await runMembershipDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'deactivate <id>',
        'Deactivate a membership',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipDeactivate } = await import('./commands/membership.js');
          await runMembershipDeactivate(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'reactivate <id>',
        'Reactivate a membership',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runMembershipReactivate } = await import('./commands/membership.js');
          await runMembershipReactivate(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify a membership subcommand')
      .strict(),
  )
  .command('invitation', 'Manage user invitations', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List invitations',
        (yargs) =>
          yargs.options({
            org: { type: 'string' },
            email: { type: 'string' },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runInvitationList } = await import('./commands/invitation.js');
          await runInvitationList(
            {
              org: argv.org,
              email: argv.email,
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
        'get <id>',
        'Get an invitation',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runInvitationGet } = await import('./commands/invitation.js');
          await runInvitationGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'send',
        'Send an invitation',
        (yargs) =>
          yargs.options({
            email: { type: 'string', demandOption: true },
            org: { type: 'string' },
            role: { type: 'string' },
            'expires-in-days': { type: 'number' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runInvitationSend } = await import('./commands/invitation.js');
          await runInvitationSend(
            { email: argv.email, org: argv.org, role: argv.role, expiresInDays: argv.expiresInDays },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'revoke <id>',
        'Revoke an invitation',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runInvitationRevoke } = await import('./commands/invitation.js');
          await runInvitationRevoke(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'resend <id>',
        'Resend an invitation',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runInvitationResend } = await import('./commands/invitation.js');
          await runInvitationResend(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify an invitation subcommand')
      .strict(),
  )
  .command('session', 'Manage user sessions', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list <userId>',
        'List sessions for a user',
        (yargs) =>
          yargs
            .positional('userId', { type: 'string', demandOption: true })
            .options({
              limit: { type: 'number' },
              before: { type: 'string' },
              after: { type: 'string' },
              order: { type: 'string' },
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runSessionList } = await import('./commands/session.js');
          await runSessionList(
            argv.userId,
            { limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'revoke <sessionId>',
        'Revoke a session',
        (yargs) => yargs.positional('sessionId', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runSessionRevoke } = await import('./commands/session.js');
          await runSessionRevoke(argv.sessionId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify a session subcommand')
      .strict(),
  )
  .command('connection', 'Manage SSO connections (read/delete)', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List connections',
        (yargs) =>
          yargs.options({
            org: { type: 'string', describe: 'Filter by org ID' },
            type: { type: 'string', describe: 'Filter by connection type' },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runConnectionList } = await import('./commands/connection.js');
          await runConnectionList(
            {
              organizationId: argv.org,
              connectionType: argv.type,
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
        'get <id>',
        'Get a connection',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runConnectionGet } = await import('./commands/connection.js');
          await runConnectionGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'delete <id>',
        'Delete a connection',
        (yargs) =>
          yargs
            .positional('id', { type: 'string', demandOption: true })
            .option('force', { type: 'boolean', default: false }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runConnectionDelete } = await import('./commands/connection.js');
          await runConnectionDelete(
            argv.id,
            { force: argv.force },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .demandCommand(1, 'Please specify a connection subcommand')
      .strict(),
  )
  .command('directory', 'Manage directory sync (read/delete, list users/groups)', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List directories',
        (yargs) =>
          yargs.options({
            org: { type: 'string' },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runDirectoryList } = await import('./commands/directory.js');
          await runDirectoryList(
            { organizationId: argv.org, limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'get <id>',
        'Get a directory',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runDirectoryGet } = await import('./commands/directory.js');
          await runDirectoryGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'delete <id>',
        'Delete a directory',
        (yargs) =>
          yargs
            .positional('id', { type: 'string', demandOption: true })
            .option('force', { type: 'boolean', default: false }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runDirectoryDelete } = await import('./commands/directory.js');
          await runDirectoryDelete(
            argv.id,
            { force: argv.force },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'list-users',
        'List directory users',
        (yargs) =>
          yargs.options({
            directory: { type: 'string' },
            group: { type: 'string' },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runDirectoryListUsers } = await import('./commands/directory.js');
          await runDirectoryListUsers(
            { directory: argv.directory, group: argv.group, limit: argv.limit, before: argv.before, after: argv.after },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'list-groups',
        'List directory groups',
        (yargs) =>
          yargs.options({
            directory: { type: 'string', demandOption: true },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runDirectoryListGroups } = await import('./commands/directory.js');
          await runDirectoryListGroups(
            { directory: argv.directory, limit: argv.limit, before: argv.before, after: argv.after },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .demandCommand(1, 'Please specify a directory subcommand')
      .strict(),
  )
  .command('event', 'Query WorkOS events', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List events',
        (yargs) =>
          yargs.options({
            events: { type: 'string', demandOption: true, describe: 'Comma-separated event types' },
            after: { type: 'string' },
            org: { type: 'string' },
            'range-start': { type: 'string' },
            'range-end': { type: 'string' },
            limit: { type: 'number' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runEventList } = await import('./commands/event.js');
          await runEventList(
            {
              events: argv.events.split(','),
              after: argv.after,
              organizationId: argv.org,
              rangeStart: argv.rangeStart,
              rangeEnd: argv.rangeEnd,
              limit: argv.limit,
            },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .demandCommand(1, 'Please specify an event subcommand')
      .strict(),
  )
  .command('audit-log', 'Manage audit logs', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'create-event <orgId>',
        'Create an audit log event',
        (yargs) =>
          yargs
            .positional('orgId', { type: 'string', demandOption: true })
            .options({
              action: { type: 'string' },
              'actor-type': { type: 'string' },
              'actor-id': { type: 'string' },
              'actor-name': { type: 'string' },
              targets: { type: 'string' },
              context: { type: 'string' },
              metadata: { type: 'string' },
              'occurred-at': { type: 'string' },
              file: { type: 'string' },
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogCreateEvent } = await import('./commands/audit-log.js');
          await runAuditLogCreateEvent(
            argv.orgId,
            {
              action: argv.action,
              actorType: argv.actorType,
              actorId: argv.actorId,
              actorName: argv.actorName,
              targets: argv.targets,
              context: argv.context,
              metadata: argv.metadata,
              occurredAt: argv.occurredAt,
              file: argv.file,
            },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'export',
        'Export audit logs',
        (yargs) =>
          yargs.options({
            org: { type: 'string', demandOption: true },
            'range-start': { type: 'string', demandOption: true },
            'range-end': { type: 'string', demandOption: true },
            actions: { type: 'string' },
            'actor-names': { type: 'string' },
            'actor-ids': { type: 'string' },
            targets: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogExport } = await import('./commands/audit-log.js');
          await runAuditLogExport(
            {
              organizationId: argv.org,
              rangeStart: argv.rangeStart,
              rangeEnd: argv.rangeEnd,
              actions: argv.actions?.split(','),
              actorNames: argv.actorNames?.split(','),
              actorIds: argv.actorIds?.split(','),
              targets: argv.targets?.split(','),
            },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'list-actions',
        'List available audit log actions',
        (yargs) => yargs,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogListActions } = await import('./commands/audit-log.js');
          await runAuditLogListActions(resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'get-schema <action>',
        'Get schema for an audit log action',
        (yargs) => yargs.positional('action', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogGetSchema } = await import('./commands/audit-log.js');
          await runAuditLogGetSchema(argv.action, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create-schema <action>',
        'Create an audit log schema',
        (yargs) =>
          yargs
            .positional('action', { type: 'string', demandOption: true })
            .option('file', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogCreateSchema } = await import('./commands/audit-log.js');
          await runAuditLogCreateSchema(
            argv.action,
            argv.file,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'get-retention <orgId>',
        'Get audit log retention period',
        (yargs) => yargs.positional('orgId', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogGetRetention } = await import('./commands/audit-log.js');
          await runAuditLogGetRetention(argv.orgId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify an audit-log subcommand')
      .strict(),
  )
  .command('feature-flag', 'Manage feature flags', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List feature flags',
        (yargs) =>
          yargs.options({
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runFeatureFlagList } = await import('./commands/feature-flag.js');
          await runFeatureFlagList(
            { limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'get <slug>',
        'Get a feature flag',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runFeatureFlagGet } = await import('./commands/feature-flag.js');
          await runFeatureFlagGet(argv.slug, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'enable <slug>',
        'Enable a feature flag',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runFeatureFlagEnable } = await import('./commands/feature-flag.js');
          await runFeatureFlagEnable(argv.slug, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'disable <slug>',
        'Disable a feature flag',
        (yargs) => yargs.positional('slug', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runFeatureFlagDisable } = await import('./commands/feature-flag.js');
          await runFeatureFlagDisable(argv.slug, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'add-target <slug> <targetId>',
        'Add a target to a feature flag',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .positional('targetId', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runFeatureFlagAddTarget } = await import('./commands/feature-flag.js');
          await runFeatureFlagAddTarget(
            argv.slug,
            argv.targetId,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'remove-target <slug> <targetId>',
        'Remove a target from a feature flag',
        (yargs) =>
          yargs
            .positional('slug', { type: 'string', demandOption: true })
            .positional('targetId', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runFeatureFlagRemoveTarget } = await import('./commands/feature-flag.js');
          await runFeatureFlagRemoveTarget(
            argv.slug,
            argv.targetId,
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .demandCommand(1, 'Please specify a feature-flag subcommand')
      .strict(),
  )
  .command('webhook', 'Manage webhooks', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List webhooks',
        (yargs) => yargs,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runWebhookList } = await import('./commands/webhook.js');
          await runWebhookList(resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create',
        'Create a webhook',
        (yargs) =>
          yargs.options({
            url: { type: 'string', demandOption: true },
            events: { type: 'string', demandOption: true, describe: 'Comma-separated event types' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runWebhookCreate } = await import('./commands/webhook.js');
          await runWebhookCreate(
            argv.url,
            argv.events.split(','),
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'delete <id>',
        'Delete a webhook',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runWebhookDelete } = await import('./commands/webhook.js');
          await runWebhookDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify a webhook subcommand')
      .strict(),
  )
  .command('config', 'Manage WorkOS configuration (redirect URIs, CORS, homepage)', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command('redirect', 'Manage redirect URIs', (yargs) =>
        yargs
          .command(
            'add <uri>',
            'Add a redirect URI',
            (yargs) => yargs.positional('uri', { type: 'string', demandOption: true }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
              const { runConfigRedirectAdd } = await import('./commands/config.js');
              await runConfigRedirectAdd(argv.uri, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
            },
          )
          .demandCommand(1)
          .strict(),
      )
      .command('cors', 'Manage CORS origins', (yargs) =>
        yargs
          .command(
            'add <origin>',
            'Add a CORS origin',
            (yargs) => yargs.positional('origin', { type: 'string', demandOption: true }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
              const { runConfigCorsAdd } = await import('./commands/config.js');
              await runConfigCorsAdd(argv.origin, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
            },
          )
          .demandCommand(1)
          .strict(),
      )
      .command('homepage-url', 'Manage homepage URL', (yargs) =>
        yargs
          .command(
            'set <url>',
            'Set the homepage URL',
            (yargs) => yargs.positional('url', { type: 'string', demandOption: true }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
              const { runConfigHomepageUrlSet } = await import('./commands/config.js');
              await runConfigHomepageUrlSet(argv.url, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
            },
          )
          .demandCommand(1)
          .strict(),
      )
      .demandCommand(1, 'Please specify a config subcommand')
      .strict(),
  )
  .command('portal', 'Manage Admin Portal', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'generate-link',
        'Generate an Admin Portal link',
        (yargs) =>
          yargs.options({
            intent: {
              type: 'string',
              demandOption: true,
              describe: 'Portal intent (sso, dsync, audit_logs, log_streams)',
            },
            org: { type: 'string', demandOption: true, describe: 'Organization ID' },
            'return-url': { type: 'string' },
            'success-url': { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runPortalGenerateLink } = await import('./commands/portal.js');
          await runPortalGenerateLink(
            { intent: argv.intent, organization: argv.org, returnUrl: argv.returnUrl, successUrl: argv.successUrl },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .demandCommand(1, 'Please specify a portal subcommand')
      .strict(),
  )
  .command('vault', 'Manage WorkOS Vault secrets', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List vault objects',
        (yargs) =>
          yargs.options({
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultList } = await import('./commands/vault.js');
          await runVaultList(
            { limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'get <id>',
        'Get a vault object',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultGet } = await import('./commands/vault.js');
          await runVaultGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'get-by-name <name>',
        'Get a vault object by name',
        (yargs) => yargs.positional('name', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultGetByName } = await import('./commands/vault.js');
          await runVaultGetByName(argv.name, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create',
        'Create a vault object',
        (yargs) =>
          yargs.options({
            name: { type: 'string', demandOption: true },
            value: { type: 'string', demandOption: true },
            org: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultCreate } = await import('./commands/vault.js');
          await runVaultCreate(
            { name: argv.name, value: argv.value, org: argv.org },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'update <id>',
        'Update a vault object',
        (yargs) =>
          yargs
            .positional('id', { type: 'string', demandOption: true })
            .options({ value: { type: 'string', demandOption: true }, 'version-check': { type: 'string' } }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultUpdate } = await import('./commands/vault.js');
          await runVaultUpdate(
            { id: argv.id, value: argv.value, versionCheck: argv.versionCheck },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'delete <id>',
        'Delete a vault object',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultDelete } = await import('./commands/vault.js');
          await runVaultDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'describe <id>',
        'Describe a vault object',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultDescribe } = await import('./commands/vault.js');
          await runVaultDescribe(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'list-versions <id>',
        'List vault object versions',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultListVersions } = await import('./commands/vault.js');
          await runVaultListVersions(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify a vault subcommand')
      .strict(),
  )
  .command('api-key', 'Manage API keys', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'list',
        'List API keys',
        (yargs) =>
          yargs.options({
            org: { type: 'string', demandOption: true },
            limit: { type: 'number' },
            before: { type: 'string' },
            after: { type: 'string' },
            order: { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runApiKeyList } = await import('./commands/api-key-mgmt.js');
          await runApiKeyList(
            { organizationId: argv.org, limit: argv.limit, before: argv.before, after: argv.after, order: argv.order },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'create',
        'Create an API key',
        (yargs) =>
          yargs.options({
            org: { type: 'string', demandOption: true },
            name: { type: 'string', demandOption: true },
            permissions: { type: 'string', describe: 'Comma-separated permissions' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runApiKeyCreate } = await import('./commands/api-key-mgmt.js');
          await runApiKeyCreate(
            { organizationId: argv.org, name: argv.name, permissions: argv.permissions?.split(',') },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      )
      .command(
        'validate <value>',
        'Validate an API key',
        (yargs) => yargs.positional('value', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runApiKeyValidate } = await import('./commands/api-key-mgmt.js');
          await runApiKeyValidate(argv.value, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'delete <id>',
        'Delete an API key',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runApiKeyDelete } = await import('./commands/api-key-mgmt.js');
          await runApiKeyDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify an api-key subcommand')
      .strict(),
  )
  .command('org-domain', 'Manage organization domains', (yargs) =>
    yargs
      .options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } })
      .command(
        'get <id>',
        'Get a domain',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainGet } = await import('./commands/org-domain.js');
          await runOrgDomainGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'create <domain>',
        'Create a domain',
        (yargs) =>
          yargs
            .positional('domain', { type: 'string', demandOption: true })
            .option('org', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainCreate } = await import('./commands/org-domain.js');
          await runOrgDomainCreate(argv.domain, argv.org, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'verify <id>',
        'Verify a domain',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainVerify } = await import('./commands/org-domain.js');
          await runOrgDomainVerify(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .command(
        'delete <id>',
        'Delete a domain',
        (yargs) => yargs.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainDelete } = await import('./commands/org-domain.js');
          await runOrgDomainDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      )
      .demandCommand(1, 'Please specify an org-domain subcommand')
      .strict(),
  )
  // --- Workflow Commands ---
  .command(
    'seed',
    'Seed WorkOS environment from a YAML config file',
    (yargs) =>
      yargs.options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
        file: { type: 'string', describe: 'Path to seed YAML file' },
        clean: { type: 'boolean', default: false, describe: 'Tear down seeded resources' },
      }),
    async (argv) => {
      await applyInsecureStorage(argv.insecureStorage);
      const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
      const { runSeed } = await import('./commands/seed.js');
      await runSeed(
        { file: argv.file, clean: argv.clean },
        resolveApiKey({ apiKey: argv.apiKey }),
        resolveApiBaseUrl(),
      );
    },
  )
  .command(
    'setup-org <name>',
    'One-shot organization onboarding (create org, domain, roles, portal link)',
    (yargs) =>
      yargs.positional('name', { type: 'string', demandOption: true, describe: 'Organization name' }).options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
        domain: { type: 'string', describe: 'Domain to add and verify' },
        roles: { type: 'string', describe: 'Comma-separated role slugs to create' },
      }),
    async (argv) => {
      await applyInsecureStorage(argv.insecureStorage);
      const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
      const { runSetupOrg } = await import('./commands/setup-org.js');
      await runSetupOrg(
        { name: argv.name, domain: argv.domain, roles: argv.roles?.split(',') },
        resolveApiKey({ apiKey: argv.apiKey }),
        resolveApiBaseUrl(),
      );
    },
  )
  .command(
    'onboard-user <email>',
    'Onboard a user (send invitation, assign role)',
    (yargs) =>
      yargs.positional('email', { type: 'string', demandOption: true }).options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
        org: { type: 'string', demandOption: true, describe: 'Organization ID' },
        role: { type: 'string', describe: 'Role slug to assign' },
        wait: { type: 'boolean', default: false, describe: 'Wait for invitation acceptance' },
      }),
    async (argv) => {
      await applyInsecureStorage(argv.insecureStorage);
      const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
      const { runOnboardUser } = await import('./commands/onboard-user.js');
      await runOnboardUser(
        { email: argv.email, org: argv.org, role: argv.role, wait: argv.wait },
        resolveApiKey({ apiKey: argv.apiKey }),
        resolveApiBaseUrl(),
      );
    },
  )
  .command(
    'debug-sso <connectionId>',
    'Diagnose SSO connection issues',
    (yargs) =>
      yargs.positional('connectionId', { type: 'string', demandOption: true }).options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
      }),
    async (argv) => {
      await applyInsecureStorage(argv.insecureStorage);
      const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
      const { runDebugSso } = await import('./commands/debug-sso.js');
      await runDebugSso(argv.connectionId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
    },
  )
  .command(
    'debug-sync <directoryId>',
    'Diagnose directory sync issues',
    (yargs) =>
      yargs.positional('directoryId', { type: 'string', demandOption: true }).options({
        ...insecureStorageOption,
        'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
      }),
    async (argv) => {
      await applyInsecureStorage(argv.insecureStorage);
      const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
      const { runDebugSync } = await import('./commands/debug-sync.js');
      await runDebugSync(argv.directoryId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
    },
  )
  .command(
    'install',
    'Install WorkOS AuthKit into your project (interactive framework detection and setup)',
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
        yargs(rawArgs).showHelp();
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
      await handleInstall({ ...argv, dashboard: false });
      process.exit(0);
    },
  )
  .strict()
  .help()
  .alias('help', 'h')
  .version(getVersion())
  .alias('version', 'v')
  .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80).argv;
