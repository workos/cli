#!/usr/bin/env bun

// Load .env.local for local development when --local flag is used
if (process.argv.includes('--local') || process.env.WORKOS_DEV) {
  const { config } = await import('dotenv');
  const { existsSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const envPath = fileURLToPath(new URL('../.env.local', import.meta.url));
  if (existsSync(envPath)) config({ path: envPath, quiet: true });
}

import { getVersion } from './lib/settings.js';

import yargs from 'yargs';
import { ensureAuthenticated } from './lib/ensure-auth.js';
import { checkForUpdates } from './lib/version-check.js';

import {
  InvalidInteractionModeError,
  isPromptAllowed,
  resolveInteractionMode,
  setInteractionMode,
} from './utils/interaction-mode.js';
import {
  resolveEffectiveOutputMode,
  resolveOutputMode,
  setOutputMode,
  isJsonMode,
  outputJson,
  outputError,
  outputApiBaseUrlIndicator,
  exitWithError,
} from './utils/output.js';
import ui, { PromptUnavailableError } from './utils/ui.js';
import { getApiBaseUrlSource } from './lib/api-key.js';
import { registerSubcommand } from './utils/register-subcommand.js';
import { installCrashReporter, sanitizeMessage } from './utils/crash-reporter.js';
import { installStoreForward, recoverPendingEvents } from './utils/telemetry-store-forward.js';
import { loadDeviceId } from './lib/device-id.js';
import { loadPreferences, isTelemetryEnabled } from './lib/preferences.js';
import { maybeShowTelemetryNotice } from './lib/telemetry-notice.js';
import {
  resolveCanonicalName,
  resolveCommandNameFromRawArgs,
  extractUserFlags,
  SKIP_TELEMETRY_COMMANDS,
} from './utils/command-telemetry.js';
import { CliExit } from './utils/cli-exit.js';
import { telemetryClient } from './utils/telemetry-client.js';
import { ExitCode } from './utils/exit-codes.js';
import { analytics } from './utils/analytics.js';
import { formatWorkOSCommand, getWorkOSCommand } from './utils/command-invocation.js';
import { MIGRATIONS_DESCRIPTION } from './lib/constants.js';
// Type-only import (erased at build, does not pull the handler into the startup
// path) so the `argv.method as VerifyLoginMethod` cast type-checks below.
import type { VerifyLoginMethod } from './commands/verify-login.js';

// Enable debug logging for all commands via env var.
// Subsumes the installer's --debug flag for non-installer commands.
if (process.env.WORKOS_DEBUG === '1') {
  const { enableDebugLogs } = await import('./utils/debug.js');
  enableDebugLogs();
}

// Telemetry infrastructure: crash reporter, store-forward, and gateway init.
// Must be before yargs so crashes during startup are captured.
installCrashReporter();
installStoreForward();
// Prewarm the telemetry opt-out preference before init: initForNonInstaller()
// checks isEnabled() (which reads the preference), and session/command events
// may fire shortly after. The sync getPreferences() fallback makes correctness
// ordering-independent, but prewarming keeps the synchronous event path off
// blocking fs IO (same rationale as the device-id prewarm).
await loadPreferences();
analytics.initForNonInstaller();
// Prewarm the device id off the blocking-fs path so the synchronous telemetry
// event path reads it from cache. Cheap (a tiny file read); awaited so it is
// resolved before any command emits an event.
await loadDeviceId();
// Fire-and-forget: recover events from previous crashes/exits.
// NO await — must not block startup (flush timeout is 3s).
recoverPendingEvents();

// Resolve output mode early from raw argv (before yargs parses)
// Bun preserves the Node-style [runtime, entrypoint, ...args] argv shape in
// both source mode and standalone executables.
const rawArgs = process.argv.slice(2);
const hasJsonFlag = rawArgs.includes('--json');
const baseOutputMode = resolveOutputMode(hasJsonFlag);
setOutputMode(baseOutputMode);
try {
  const interaction = resolveInteractionMode({ argv: rawArgs });
  setInteractionMode(interaction);
  setOutputMode(resolveEffectiveOutputMode(baseOutputMode, interaction));
} catch (error) {
  if (error instanceof InvalidInteractionModeError) {
    outputError({ code: 'invalid_mode', message: error.message });
    process.exit(ExitCode.GENERAL_ERROR);
  }
  if (error instanceof CliExit) process.exit(error.exitCode);
  throw error;
}

// Intercept --help --json before yargs parses (yargs exits on --help)
if (hasJsonFlag && (rawArgs.includes('--help') || rawArgs.includes('-h'))) {
  const { buildCommandTree, extractHelpJsonCommand } = await import('./utils/help-json.js');
  const command = extractHelpJsonCommand(rawArgs);
  outputJson(buildCommandTree(command));
  // Writes to a piped stdout are asynchronous: exiting immediately truncates
  // anything past the 64KiB pipe buffer (the full command tree is larger).
  // Queue an empty write and exit only once everything before it has flushed.
  await new Promise<void>((resolve) => process.stdout.write('', () => resolve()));
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

/** Show non-blocking warning if active env is unclaimed (once per session). */
async function maybeWarnUnclaimed(): Promise<void> {
  const { warnIfUnclaimed } = await import('./lib/unclaimed-warning.js');
  await warnIfUnclaimed();
}

import { resolveInstallCredentials } from './lib/resolve-install-credentials.js';

/** Shared insecure-storage option for commands that access credentials */
const insecureStorageOption = {
  'insecure-storage': {
    default: false,
    describe: 'Store credentials in plaintext file instead of system keyring',
    type: 'boolean' as const,
  },
} as const;

/**
 * Shared override for the "AuthKit is already installed" preflight guard.
 *
 * Distinct from `--force-install` below, which only relaxes peer-dependency
 * checks during package installation.
 */
const forceOption = {
  force: {
    default: false,
    describe: 'Continue even if AuthKit is already installed in this project',
    type: 'boolean' as const,
  },
} as const;

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
  scaffold: {
    default: false,
    describe: 'Scaffold a new Next.js app when run in an empty directory',
    type: 'boolean' as const,
  },
  pm: {
    describe: 'Package manager for the scaffolded app',
    choices: ['npm', 'pnpm', 'yarn', 'bun'] as const,
    type: 'string' as const,
  },
  router: {
    choices: ['app', 'pages'] as const,
    describe: 'Next.js router to target when detection is ambiguous (app or pages)',
    type: 'string' as const,
  },
  ...forceOption,
};

// Check for updates (blocks up to 500ms, skip in JSON/non-human modes to keep machine streams clean)
if (!isJsonMode() && isPromptAllowed()) await checkForUpdates();

async function runCli(): Promise<void> {
  const startTime = Date.now();
  let commandName = 'root';
  const flags = extractUserFlags(rawArgs);

  const parser = yargs(rawArgs)
    .scriptName('workos')
    .parserConfiguration({ 'populate--': true })
    .exitProcess(false)
    .fail((msg, err) => {
      if (err instanceof CliExit) throw err;
      // yargs runs its demand/strict validation before dispatching middleware,
      // so the command-name middleware below has not run yet and commandName is
      // still 'root' (which SKIP_TELEMETRY_COMMANDS would drop). Recover the
      // top-level command from the raw args so the validation_error event is
      // attributed to the real command instead of being silently skipped. Only
      // the top-level token is used. Later positionals can be user values
      // (org names, emails, IDs), so recording them would leak data.
      if (commandName === 'root') {
        commandName = resolveCommandNameFromRawArgs(rawArgs);
      }
      if (msg) {
        outputError({ code: 'invalid_usage', message: msg });
      }
      throw new CliExit(ExitCode.GENERAL_ERROR, { reason: 'validation_error' });
    })
    .env('WORKOS_INSTALLER')
    .option('json', {
      type: 'boolean',
      default: false,
      describe: 'Output results as JSON (auto-enabled in non-TTY)',
      global: true,
    })
    .option('mode', {
      type: 'string',
      choices: ['human', 'agent', 'ci'] as const,
      describe: 'Interaction mode: human, coding agent, or CI automation',
      global: true,
    })
    .middleware((argv) => {
      const commandParts = (argv._ as string[]) || [];
      commandName = resolveCanonicalName(commandParts);
    })
    .middleware((argv) => {
      // Surface a non-prod API base URL once per command, human mode only.
      // Gated on !isJsonMode() so automation/JSON paths skip the config read
      // entirely — API commands still validate the URL at call time via
      // resolveApiBaseUrl(). Skip the bare root command (`workos` /
      // `--help` / `--version`); there is no API call to attribute it to.
      // outputApiBaseUrlIndicator no-ops when the base URL is the prod default.
      if (isJsonMode() || String(argv._?.[0] ?? '') === '') return;
      outputApiBaseUrlIndicator(getApiBaseUrlSource());
    })
    .middleware((argv) => {
      // First-run, stderr-only notice that telemetry is being collected.
      // Skip while the user is actively managing telemetry, and on the
      // empty/root command (bare `--help` / `--version` / `$0`). The notice
      // is self-guarded — it no-ops in json mode, when already shown, when
      // opted out, and after the first display this session.
      const command = String(argv._?.[0] ?? '');
      if (command === 'telemetry' || command === '') return;
      maybeShowTelemetryNotice();
    })
    .middleware(async (argv) => {
      // Warn about unclaimed environments before management commands.
      // Excluded: auth/claim/install/setup/dashboard handle their own credential
      // or onboarding flows; skills/doctor/env/debug are utility commands where
      // the warning is unnecessary.
      const command = String(argv._?.[0] ?? '');
      if (
        [
          'auth',
          'whoami',
          'skills',
          'doctor',
          'env',
          'claim',
          'install',
          'setup',
          'debug',
          'internal',
          'dashboard',
          'emulate',
          'dev',
          'migrations',
          '',
        ].includes(command)
      )
        return;
      await applyInsecureStorage(argv.insecureStorage as boolean | undefined);
      await maybeWarnUnclaimed();
    })
    .command('auth', 'Manage authentication (login, logout, status)', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'login',
        'Authenticate with WorkOS via browser-based OAuth',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runLogin } = await import('./commands/login.js');
          await runLogin();
        },
      );
      registerSubcommand(
        yargs,
        'logout',
        'Remove stored WorkOS credentials and tokens',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runLogout } = await import('./commands/logout.js');
          await runLogout();
        },
      );
      registerSubcommand(
        yargs,
        'status',
        'Show current authentication status',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runAuthStatus } = await import('./commands/auth-status.js');
          await runAuthStatus();
        },
      );
      return yargs.demandCommand(1, 'Please specify an auth subcommand').strict();
    })
    .command(
      'whoami',
      'Show the authenticated user, team, and environment (dashboard session)',
      (yargs) =>
        yargs.options(insecureStorageOption).option('environment-id', {
          type: 'string',
          describe: 'Environment ID to target (defaults to the active environment)',
        }),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage as boolean | undefined);
        const { runWhoami } = await import('./commands/whoami.js');
        await runWhoami({ environmentId: argv.environmentId as string | undefined });
      },
    )
    .command(
      'environment',
      'Manage WorkOS environments (create, rename) on the dashboard account plane',
      (yargs) => {
        yargs.options(insecureStorageOption);
        registerSubcommand(
          yargs,
          'create <name>',
          'Create a sandbox or production environment',
          (y) =>
            y
              .positional('name', { type: 'string', demandOption: true, describe: 'Environment name' })
              .option('sandbox', { type: 'boolean', default: false, describe: 'Create a sandbox environment' })
              .option('environment-id', {
                type: 'string',
                describe: 'Environment ID whose project receives the new environment (defaults to the active environment)',
              }),
          async (argv) => {
            await applyInsecureStorage(argv.insecureStorage);
            const { runEnvironmentCreate } = await import('./commands/environment.js');
            await runEnvironmentCreate({
              name: argv.name,
              sandbox: Boolean(argv.sandbox),
              environmentId: argv.environmentId as string | undefined,
            });
          },
        );
        registerSubcommand(
          yargs,
          'rename <environmentId> <name>',
          'Rename an environment',
          (y) =>
            y
              .positional('environmentId', { type: 'string', demandOption: true, describe: 'Environment ID' })
              .positional('name', { type: 'string', demandOption: true, describe: 'New environment name' }),
          async (argv) => {
            await applyInsecureStorage(argv.insecureStorage);
            const { runEnvironmentRename } = await import('./commands/environment.js');
            await runEnvironmentRename({ environmentId: argv.environmentId, name: argv.name });
          },
        );
        return yargs.demandCommand(1, 'Please specify an environment subcommand').strict();
      },
    )
    .command('project', 'Manage WorkOS projects (create, rename, list) on the dashboard account plane', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'create <name>',
        'Create a project with fresh staging and production environments',
        (y) =>
          y
            .positional('name', { type: 'string', demandOption: true, describe: 'Project name' })
            .option('production', {
              type: 'boolean',
              default: true,
              describe: 'Provision a production environment (use --no-production for staging only)',
            })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Confirm in non-interactive mode' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runProjectCreate } = await import('./commands/project.js');
          await runProjectCreate({
            name: argv.name,
            production: argv.production !== false,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'rename <projectId> <name>',
        'Rename a project',
        (y) =>
          y
            .positional('projectId', { type: 'string', demandOption: true, describe: 'Project ID' })
            .positional('name', { type: 'string', demandOption: true, describe: 'New project name' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runProjectRename } = await import('./commands/project.js');
          await runProjectRename({ projectId: argv.projectId, name: argv.name });
        },
      );
      registerSubcommand(
        yargs,
        'list',
        'List projects in the current team',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runProjectList } = await import('./commands/project.js');
          await runProjectList();
        },
      );
      return yargs.demandCommand(1, 'Please specify a project subcommand').strict();
    })
    .command(
      'authkit',
      'Manage AuthKit app config (redirect URIs, CORS, logout URIs, branding) on the dashboard account plane',
      (yargs) => {
        yargs.options(insecureStorageOption);

        yargs.command('redirect-uris', 'Manage AuthKit redirect URIs', (yargs) => {
          registerSubcommand(
            yargs,
            'list',
            'List configured redirect URIs for an environment',
            (y) =>
              y
                .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' })
                .option('limit', { type: 'number', describe: 'Maximum number of URIs to return' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitRedirectUrisList } = await import('./commands/authkit.js');
              await runAuthkitRedirectUrisList({
                environmentId: argv.environmentId as string | undefined,
                limit: argv.limit as number | undefined,
              });
            },
          );
          registerSubcommand(
            yargs,
            'set',
            'Set the allowed redirect URIs for an environment (replaces the full list)',
            (y) =>
              y
                .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' })
                .option('uri', { type: 'string', array: true, demandOption: true, describe: 'Redirect URI (repeatable)' })
                .option('default', { type: 'string', describe: 'Which URI to mark as the default' })
                .option('dry-run', { type: 'boolean', default: false, describe: 'Validate without saving' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitRedirectUrisSet } = await import('./commands/authkit.js');
              await runAuthkitRedirectUrisSet({
                environmentId: argv.environmentId as string | undefined,
                uris: argv.uri as string[],
                default: argv.default as string | undefined,
                dryRun: Boolean(argv.dryRun),
              });
            },
          );
          return yargs.demandCommand(1, 'Please specify a redirect-uris subcommand').strict();
        });

        yargs.command('cors', 'Manage AuthKit CORS web origins', (yargs) => {
          registerSubcommand(
            yargs,
            'get',
            'Show the allowed web origins (CORS) for an environment',
            (y) => y.option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitCorsGet } = await import('./commands/authkit.js');
              await runAuthkitCorsGet({ environmentId: argv.environmentId as string | undefined });
            },
          );
          registerSubcommand(
            yargs,
            'set',
            'Set the allowed web origins (CORS) for an environment (replaces the full list)',
            (y) =>
              y
                .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' })
                .option('origin', { type: 'string', array: true, demandOption: true, describe: 'Web origin (repeatable)' })
                .option('dry-run', { type: 'boolean', default: false, describe: 'Validate without saving' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitCorsSet } = await import('./commands/authkit.js');
              await runAuthkitCorsSet({
                environmentId: argv.environmentId as string | undefined,
                origins: argv.origin as string[],
                dryRun: Boolean(argv.dryRun),
              });
            },
          );
          return yargs.demandCommand(1, 'Please specify a cors subcommand').strict();
        });

        yargs.command('logout-uris', 'Manage AuthKit logout URIs', (yargs) => {
          registerSubcommand(
            yargs,
            'list',
            'List configured logout URIs for an environment',
            (y) =>
              y
                .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' })
                .option('limit', { type: 'number', describe: 'Maximum number of URIs to return' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitLogoutUrisList } = await import('./commands/authkit.js');
              await runAuthkitLogoutUrisList({
                environmentId: argv.environmentId as string | undefined,
                limit: argv.limit as number | undefined,
              });
            },
          );
          registerSubcommand(
            yargs,
            'set',
            'Set the allowed logout URIs for an environment (replaces the full list)',
            (y) =>
              y
                .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' })
                .option('uri', { type: 'string', array: true, demandOption: true, describe: 'Logout URI (repeatable)' })
                .option('default', { type: 'string', describe: 'Which URI to mark as the default' })
                .option('dry-run', { type: 'boolean', default: false, describe: 'Validate without saving' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitLogoutUrisSet } = await import('./commands/authkit.js');
              await runAuthkitLogoutUrisSet({
                environmentId: argv.environmentId as string | undefined,
                uris: argv.uri as string[],
                default: argv.default as string | undefined,
                dryRun: Boolean(argv.dryRun),
              });
            },
          );
          return yargs.demandCommand(1, 'Please specify a logout-uris subcommand').strict();
        });

        yargs.command('branding', 'Manage AuthKit branding', (yargs) => {
          registerSubcommand(
            yargs,
            'get',
            'Show AuthKit branding (logos, theme) for an environment',
            (y) => y.option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
            async (argv) => {
              await applyInsecureStorage(argv.insecureStorage);
              const { runAuthkitBrandingGet } = await import('./commands/authkit.js');
              await runAuthkitBrandingGet({ environmentId: argv.environmentId as string | undefined });
            },
          );
          return yargs.demandCommand(1, 'Please specify a branding subcommand').strict();
        });

        return yargs.demandCommand(1, 'Please specify an authkit subcommand').strict();
      },
    )
    .command('team', 'Manage the WorkOS dashboard team (members, invites, settings)', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'members',
        'List members of the current team',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamMembers } = await import('./commands/team.js');
          await runTeamMembers();
        },
      );
      registerSubcommand(
        yargs,
        'invite <email>',
        'Invite a user to the current team by email',
        (y) =>
          y
            .positional('email', { type: 'string', demandOption: true, describe: 'Email address to invite' })
            .option('role', { type: 'string', demandOption: true, describe: 'Role (ADMIN, MEMBER, ...)' })
            .option('first-name', { type: 'string', describe: 'First name' })
            .option('last-name', { type: 'string', describe: 'Last name' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamInvite } = await import('./commands/team.js');
          await runTeamInvite({
            email: argv.email,
            role: argv.role as string,
            firstName: argv.firstName as string | undefined,
            lastName: argv.lastName as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'change-role <membershipId> <role>',
        "Change a team member's role",
        (y) =>
          y
            .positional('membershipId', { type: 'string', demandOption: true, describe: 'Team membership ID' })
            .positional('role', { type: 'string', demandOption: true, describe: 'New role (ADMIN, MEMBER, ...)' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Confirm in non-interactive mode' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamChangeRole } = await import('./commands/team.js');
          await runTeamChangeRole({
            membershipId: argv.membershipId,
            role: argv.role,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'remove <membershipId>',
        'Remove a member from the current team',
        (y) =>
          y
            .positional('membershipId', { type: 'string', demandOption: true, describe: 'Team membership ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamRemove } = await import('./commands/team.js');
          await runTeamRemove({ membershipId: argv.membershipId, yes: argv.yes, json: argv.json as boolean | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'resend-invite <membershipId>',
        'Resend an expired team invitation',
        (y) => y.positional('membershipId', { type: 'string', demandOption: true, describe: 'Team membership ID' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamResendInvite } = await import('./commands/team.js');
          await runTeamResendInvite({ membershipId: argv.membershipId });
        },
      );
      registerSubcommand(
        yargs,
        'update <name>',
        'Rename the current team',
        (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'New team name' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamUpdate } = await import('./commands/team.js');
          await runTeamUpdate({ name: argv.name });
        },
      );
      registerSubcommand(
        yargs,
        'set-mfa <required>',
        'Set whether MFA is required for the team',
        (y) =>
          y
            .positional('required', { type: 'boolean', demandOption: true, describe: 'true to require MFA, false to relax' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Confirm in non-interactive mode' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runTeamSetMfa } = await import('./commands/team.js');
          await runTeamSetMfa({
            required: Boolean(argv.required),
            yes: argv.yes,
            json: argv.json as boolean | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a team subcommand').strict();
    })
    .command('telemetry', 'Manage telemetry collection (opt-out, opt-in, status)', (yargs) => {
      registerSubcommand(
        yargs,
        'opt-out',
        'Disable telemetry collection (persists across runs)',
        (y) => y,
        async () => {
          const { runTelemetryOptOut } = await import('./commands/telemetry.js');
          await runTelemetryOptOut();
        },
      );
      registerSubcommand(
        yargs,
        'opt-in',
        'Re-enable telemetry collection',
        (y) => y,
        async () => {
          const { runTelemetryOptIn } = await import('./commands/telemetry.js');
          await runTelemetryOptIn();
        },
      );
      registerSubcommand(
        yargs,
        'status',
        'Show whether telemetry is enabled and why',
        (y) => y,
        async () => {
          const { runTelemetryStatus } = await import('./commands/telemetry.js');
          await runTelemetryStatus();
        },
      );
      return yargs.demandCommand(1, 'Please specify a telemetry subcommand').strict();
    })
    .command('skills', 'Manage WorkOS skills for coding agents (Claude Code, Codex, Cursor, Goose)', (yargs) => {
      registerSubcommand(
        yargs,
        'install',
        'Install bundled AuthKit skills to coding agents',
        (y) =>
          y
            .option('skill', {
              alias: 's',
              type: 'array',
              string: true,
              description: 'Install specific skill(s) by name',
            })
            .option('agent', {
              alias: 'a',
              type: 'array',
              string: true,
              description: 'Target specific agent(s): claude-code, codex, cursor, goose',
            }),
        async (argv) => {
          const { runInstallSkill } = await import('./commands/install-skill.js');
          await runInstallSkill({
            skill: argv.skill as string[] | undefined,
            agent: argv.agent as string[] | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'uninstall',
        'Remove installed WorkOS skills from coding agents',
        (y) =>
          y
            .option('skill', {
              alias: 's',
              type: 'array',
              string: true,
              description: 'Remove specific skill(s) by name',
            })
            .option('agent', {
              alias: 'a',
              type: 'array',
              string: true,
              description: 'Target specific agent(s): claude-code, codex, cursor, goose',
            }),
        async (argv) => {
          const { runUninstallSkill } = await import('./commands/uninstall-skill.js');
          await runUninstallSkill({
            skill: argv.skill as string[] | undefined,
            agent: argv.agent as string[] | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'list',
        'List available and installed skills',
        (y) =>
          y.option('agent', {
            alias: 'a',
            type: 'array',
            string: true,
            description: 'Target specific agent(s): claude-code, codex, cursor, goose',
          }),
        async (argv) => {
          const { runListSkills } = await import('./commands/list-skills.js');
          await runListSkills({
            agent: argv.agent as string[] | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a skills subcommand').strict();
    })
    .command('mcp', 'Manage the WorkOS MCP server in coding agents (Claude Code, Codex, Cursor)', (yargs) => {
      registerSubcommand(
        yargs,
        'install',
        'Configure the WorkOS MCP server in detected coding agents',
        (y) =>
          y.option('agent', {
            alias: 'a',
            type: 'array',
            string: true,
            description: 'Target specific agent(s): claude-code, codex, cursor',
          }),
        async (argv) => {
          const { runMcpInstall } = await import('./commands/mcp.js');
          await runMcpInstall({ agent: argv.agent as string[] | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'remove',
        'Remove the WorkOS MCP server from coding agents',
        (y) =>
          y.option('agent', {
            alias: 'a',
            type: 'array',
            string: true,
            description: 'Target specific agent(s): claude-code, codex, cursor',
          }),
        async (argv) => {
          const { runMcpRemove } = await import('./commands/mcp.js');
          await runMcpRemove({ agent: argv.agent as string[] | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'status',
        'Show which coding agents have the WorkOS MCP server configured',
        (y) => y,
        async () => {
          const { runMcpStatus } = await import('./commands/mcp.js');
          await runMcpStatus();
        },
      );
      return yargs.demandCommand(1, 'Please specify an mcp subcommand').strict();
    })
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
          fix: {
            type: 'boolean',
            default: false,
            description: 'Auto-update stale WorkOS skills (writes to <agent>/skills/workos/ and workos-widgets/ only)',
          },
        }),
      async (argv) => {
        const { handleDoctor } = await import('./commands/doctor.js');
        await handleDoctor(argv);
      },
    )
    .command(
      'verify-login',
      'Verify the AuthKit login loop end-to-end against the active environment (creates and deletes a throwaway user)',
      (yargs) =>
        yargs.options({
          ...insecureStorageOption,
          'api-key': {
            type: 'string' as const,
            describe: 'WorkOS API key (overrides environment config). Format: sk_test_* (production keys are refused)',
          },
          'client-id': {
            type: 'string' as const,
            describe: 'WorkOS client ID (overrides the active environment)',
          },
          method: {
            type: 'string' as const,
            choices: ['password'] as const,
            default: 'password',
            describe: 'Authentication method to verify',
          },
        }),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage as boolean | undefined);
        const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
        const { getActiveEnvironment } = await import('./lib/config-store.js');
        const { runVerifyLogin } = await import('./commands/verify-login.js');

        const apiKey = resolveApiKey({ apiKey: argv.apiKey as string | undefined }); // exits 4 if none
        const activeEnv = getActiveEnvironment();

        await runVerifyLogin({
          apiKey,
          clientId: (argv.clientId as string | undefined) ?? activeEnv?.clientId,
          baseUrl: resolveApiBaseUrl(),
          envType: activeEnv?.type ?? null,
          envName: activeEnv?.name,
          method: argv.method as VerifyLoginMethod,
        });
      },
    )
    // NOTE: When adding commands here, also update src/utils/help-json.ts
    .command('env', 'Manage environment configurations (API keys, endpoints, active environment)', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'add [name] [apiKey]',
        'Add an environment configuration',
        (y) =>
          y
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
      );
      registerSubcommand(
        yargs,
        'remove <name>',
        'Remove an environment from local CLI config (does not delete or unclaim the environment in WorkOS)',
        (y) => y.positional('name', { type: 'string', demandOption: true, describe: 'Environment name' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvRemove } = await import('./commands/env.js');
          await runEnvRemove(argv.name);
        },
      );
      registerSubcommand(
        yargs,
        'switch [name]',
        'Switch active environment',
        (y) => y.positional('name', { type: 'string', describe: 'Environment name' }),
        async (argv) => {
          if (!argv.name && !isPromptAllowed()) {
            exitWithError({
              code: 'missing_args',
              message: `Environment name required. Usage: ${formatWorkOSCommand('env switch <name>')}`,
            });
          }
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvSwitch } = await import('./commands/env.js');
          await runEnvSwitch(argv.name);
        },
      );
      registerSubcommand(
        yargs,
        'list',
        'List configured environments',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvList } = await import('./commands/env.js');
          await runEnvList();
        },
      );
      registerSubcommand(
        yargs,
        'claim',
        'Claim an unclaimed environment — link it to your account (permanent — cannot be undone)',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runClaim } = await import('./commands/claim.js');
          await runClaim();
        },
      );
      registerSubcommand(
        yargs,
        'provision',
        'Provision a new unclaimed WorkOS environment (credentials only, no code changes)',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runEnvProvision } = await import('./commands/env.js');
          await runEnvProvision();
        },
      );
      return yargs.demandCommand(1, 'Please specify an env subcommand').strict();
    })
    .command(
      'api [endpoint] [filter]',
      'Make authenticated requests to the WorkOS API',
      (yargs) =>
        yargs
          .options(insecureStorageOption)
          .positional('endpoint', {
            type: 'string',
            describe: "API endpoint path (e.g. /users), or 'ls' to list endpoints",
          })
          .positional('filter', {
            type: 'string',
            describe: 'Filter keyword (used with ls)',
          })
          .option('method', {
            alias: 'X',
            type: 'string',
            describe: 'HTTP method (default: GET, or POST if body provided)',
          })
          .option('data', {
            alias: 'd',
            type: 'string',
            describe: 'JSON request body',
          })
          .option('file', {
            type: 'string',
            describe: 'Read request body from a file (or - for stdin)',
          })
          .option('include', {
            alias: 'i',
            type: 'boolean',
            default: false,
            describe: 'Show response headers',
          })
          .option('api-key', {
            type: 'string',
            describe: 'Override the API key',
          })
          .option('dry-run', {
            type: 'boolean',
            default: false,
            describe: 'Show the request without executing it',
          })
          .option('yes', {
            alias: 'y',
            type: 'boolean',
            default: false,
            describe: 'Skip confirmation for mutating requests',
          })
          .example('workos api ls', 'List all available endpoints')
          .example('workos api ls users', 'List endpoints matching "users"')
          .example('workos api /user_management/users', 'GET /user_management/users')
          .example('workos api /organizations -d \'{"name":"Acme"}\'', 'POST with a JSON body')
          .example('workos api /organizations/org_123 -X DELETE', 'DELETE an organization'),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage as boolean | undefined);
        const endpoint = argv.endpoint as string | undefined;
        const filter = argv.filter as string | undefined;

        const { runApiLs, runApiRequest, runApiInteractive } = await import('./commands/api/index.js');

        if (!endpoint) {
          await runApiInteractive({ apiKey: argv.apiKey as string | undefined });
          return;
        }

        if (endpoint === 'ls') {
          await runApiLs(filter);
          return;
        }

        await runApiRequest(endpoint, {
          method: argv.method,
          data: argv.data,
          file: argv.file,
          include: argv.include,
          apiKey: argv.apiKey,
          dryRun: argv.dryRun,
          yes: argv.yes,
        });
      },
    )
    .command(['organization', 'org'], 'Manage WorkOS organizations (create, update, get, list, delete)', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'create <name> [domains..]',
        'Create a new organization with optional verified domains',
        (y) =>
          y
            .positional('name', { type: 'string', demandOption: true, describe: 'Organization name' })
            .positional('domains', {
              type: 'string',
              array: true,
              describe: 'Domains in format domain:state (state defaults to verified)',
            })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runOrgCreate } = await import('./commands/organization.js');
          await runOrgCreate(argv.name, (argv.domains as string[]) || [], {
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'update <orgId> <name> [domain] [state]',
        'Update an organization',
        (y) =>
          y
            .positional('orgId', { type: 'string', demandOption: true, describe: 'Organization ID' })
            .positional('name', { type: 'string', demandOption: true, describe: 'Organization name' })
            .positional('domain', { type: 'string', describe: 'Domain' })
            .positional('state', { type: 'string', describe: 'Domain state (verified or pending)' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runOrgUpdate } = await import('./commands/organization.js');
          await runOrgUpdate(argv.orgId, argv.name, {
            domain: argv.domain,
            state: argv.state,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'get <orgId>',
        'Get an organization by ID',
        (y) =>
          y
            .positional('orgId', { type: 'string', demandOption: true, describe: 'Organization ID' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runOrgGet } = await import('./commands/organization.js');
          await runOrgGet(argv.orgId, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'list',
        'List organizations',
        (y) =>
          y.options({
            domain: { type: 'string', describe: 'Filter by domain (name/domain search)' },
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            order: { type: 'string', describe: 'Order of results (asc or desc)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runOrgList } = await import('./commands/organization.js');
          await runOrgList({
            domain: argv.domain,
            limit: argv.limit,
            before: argv.before,
            after: argv.after,
            order: argv.order,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'delete <orgId>',
        'Delete an organization',
        (y) =>
          y
            .positional('orgId', { type: 'string', demandOption: true, describe: 'Organization ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runOrgDelete } = await import('./commands/organization.js');
          await runOrgDelete(argv.orgId, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify an organization subcommand').strict();
    })
    .command('user', 'Manage AuthKit users (get, list, update, delete)', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'get <userId>',
        'Get a user by ID',
        (y) =>
          y
            .positional('userId', { type: 'string', demandOption: true, describe: 'User ID' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runUserGet } = await import('./commands/user.js');
          await runUserGet(argv.userId, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'list',
        'List users',
        (y) =>
          y.options({
            email: { type: 'string', describe: 'Filter by email (search)' },
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            order: { type: 'string', describe: 'Order of results (asc or desc)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runUserList } = await import('./commands/user.js');
          await runUserList({
            email: argv.email,
            limit: argv.limit,
            before: argv.before,
            after: argv.after,
            order: argv.order,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'update <userId>',
        'Update a user',
        (y) =>
          y.positional('userId', { type: 'string', demandOption: true, describe: 'User ID' }).options({
            'first-name': { type: 'string', describe: 'First name' },
            'last-name': { type: 'string', describe: 'Last name' },
            email: { type: 'string', describe: 'New email address' },
            locale: { type: 'string', describe: 'Locale (e.g. en-US)' },
            'external-id': { type: 'string', describe: 'External ID' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runUserUpdate } = await import('./commands/user.js');
          await runUserUpdate(argv.userId, {
            firstName: argv.firstName,
            lastName: argv.lastName,
            email: argv.email,
            locale: argv.locale,
            externalId: argv.externalId,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'delete <userId>',
        'Delete a user',
        (y) =>
          y
            .positional('userId', { type: 'string', demandOption: true, describe: 'User ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runUserDelete } = await import('./commands/user.js');
          await runUserDelete(argv.userId, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a user subcommand').strict();
    })
    // --- Resource Management Commands ---
    .command('role', 'Manage WorkOS roles (environment and organization-scoped)', (yargs) => {
      yargs.options({
        ...insecureStorageOption,
        org: { type: 'string' as const, describe: 'Organization ID (for organization roles)' },
      });
      registerSubcommand(
        yargs,
        'list',
        'List roles',
        (y) =>
          y.option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleList } = await import('./commands/role.js');
          await runRoleList({ org: argv.org, environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'get <slug>',
        'Get a role by slug',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleGet } = await import('./commands/role.js');
          await runRoleGet(argv.slug, { org: argv.org, environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'create',
        'Create a role',
        (y) =>
          y.options({
            slug: { type: 'string', demandOption: true, describe: 'Role slug' },
            name: { type: 'string', demandOption: true, describe: 'Role name' },
            description: { type: 'string', describe: 'Role description' },
            yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleCreate } = await import('./commands/role.js');
          await runRoleCreate({
            slug: argv.slug,
            name: argv.name,
            description: argv.description,
            org: argv.org,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'update <slug>',
        'Update a role',
        (y) =>
          y.positional('slug', { type: 'string', demandOption: true }).options({
            name: { type: 'string' },
            description: { type: 'string' },
            yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleUpdate } = await import('./commands/role.js');
          await runRoleUpdate(argv.slug, {
            name: argv.name,
            description: argv.description,
            org: argv.org,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'delete <slug>',
        'Delete an org-scoped role (requires --org)',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .demandOption('org')
            .options({
              yes: { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' },
              'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleDelete } = await import('./commands/role.js');
          await runRoleDelete(argv.slug, {
            org: argv.org!,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'set-permissions <slug>',
        'Set all permissions on a role (replaces existing)',
        (y) =>
          y.positional('slug', { type: 'string', demandOption: true }).options({
            permissions: { type: 'string', demandOption: true, describe: 'Comma-separated permission slugs' },
            yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleSetPermissions } = await import('./commands/role.js');
          await runRoleSetPermissions(argv.slug, argv.permissions.split(','), {
            org: argv.org,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'add-permission <slug> <permissionSlug>',
        'Add a permission to a role',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .positional('permissionSlug', { type: 'string', demandOption: true })
            .options({
              yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
              'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleAddPermission } = await import('./commands/role.js');
          await runRoleAddPermission(argv.slug, argv.permissionSlug, {
            org: argv.org,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'remove-permission <slug> <permissionSlug>',
        'Remove a permission from an org role (requires --org)',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .positional('permissionSlug', { type: 'string', demandOption: true })
            .demandOption('org')
            .options({
              yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
              'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runRoleRemovePermission } = await import('./commands/role.js');
          await runRoleRemovePermission(argv.slug, argv.permissionSlug, {
            org: argv.org!,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a role subcommand').strict();
    })
    .command('permission', 'Manage WorkOS permissions', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'list',
        'List permissions',
        (y) =>
          y.option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runPermissionList } = await import('./commands/permission.js');
          await runPermissionList({ environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'get <slug>',
        'Get a permission',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runPermissionGet } = await import('./commands/permission.js');
          await runPermissionGet(argv.slug, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'create',
        'Create a permission',
        (y) =>
          y.options({
            slug: { type: 'string', demandOption: true, describe: 'Permission slug' },
            name: { type: 'string', demandOption: true, describe: 'Permission name' },
            description: { type: 'string', describe: 'Permission description' },
            yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runPermissionCreate } = await import('./commands/permission.js');
          await runPermissionCreate({
            slug: argv.slug,
            name: argv.name,
            description: argv.description,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'update <slug>',
        'Update a permission',
        (y) =>
          y.positional('slug', { type: 'string', demandOption: true }).options({
            name: { type: 'string' },
            description: { type: 'string' },
            yes: { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runPermissionUpdate } = await import('./commands/permission.js');
          await runPermissionUpdate(argv.slug, {
            name: argv.name,
            description: argv.description,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'delete <slug>',
        'Delete a permission',
        (y) =>
          y.positional('slug', { type: 'string', demandOption: true }).options({
            yes: { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runPermissionDelete } = await import('./commands/permission.js');
          await runPermissionDelete(argv.slug, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a permission subcommand').strict();
    })
    .command('membership', 'Manage organization memberships', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'list',
        'List memberships by user or organization',
        (y) =>
          y.options({
            org: { type: 'string', describe: 'Organization ID (org_*)' },
            user: { type: 'string', describe: 'User ID (user_*)' },
            limit: { type: 'number', describe: 'Limit number of results (--org only)' },
            before: { type: 'string', describe: 'Cursor for results before a specific item (--org only)' },
            after: { type: 'string', describe: 'Cursor for results after a specific item (--org only)' },
            order: { type: 'string', describe: 'Order of results, asc or desc (--org only)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipList } = await import('./commands/membership.js');
          await runMembershipList({
            org: argv.org,
            user: argv.user,
            limit: argv.limit,
            before: argv.before,
            after: argv.after,
            order: argv.order,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'get <id>',
        'Get a membership',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Membership ID' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipGet } = await import('./commands/membership.js');
          await runMembershipGet(argv.id, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'create',
        'Add a user to an organization',
        (y) =>
          y.options({
            org: { type: 'string', demandOption: true, describe: 'Organization ID (org_*)' },
            user: { type: 'string', demandOption: true, describe: 'User ID (user_*)' },
            role: { type: 'string', describe: 'Role ID (role_*) to assign' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipCreate } = await import('./commands/membership.js');
          await runMembershipCreate({
            org: argv.org,
            user: argv.user,
            role: argv.role,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'update <id>',
        "Change a membership's role",
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Membership ID' })
            .option('role', { type: 'string', describe: 'Role ID (role_*) to assign' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipUpdate } = await import('./commands/membership.js');
          await runMembershipUpdate(argv.id, {
            role: argv.role,
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete a membership (removes the user from the organization)',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Membership ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipDelete } = await import('./commands/membership.js');
          await runMembershipDelete(argv.id, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'deactivate <id>',
        'Deactivate a membership',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Membership ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Confirm the change (required non-interactively)' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipDeactivate } = await import('./commands/membership.js');
          await runMembershipDeactivate(argv.id, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'reactivate <id>',
        'Reactivate a membership',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Membership ID' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runMembershipReactivate } = await import('./commands/membership.js');
          await runMembershipReactivate(argv.id, { environmentId: argv.environmentId as string | undefined });
        },
      );
      return yargs.demandCommand(1, 'Please specify a membership subcommand').strict();
    })
    .command('invitation', 'Manage user invitations', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'list',
        'List invitations',
        (y) =>
          y.options({
            org: { type: 'string', describe: 'Organization ID (org_*)' },
            email: { type: 'string', describe: 'Filter by email (search)' },
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runInvitationList } = await import('./commands/invitation.js');
          await runInvitationList({
            org: argv.org,
            email: argv.email,
            limit: argv.limit,
            before: argv.before,
            after: argv.after,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'get <id>',
        'Get an invitation (searches the most recent invitations)',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Invitation ID' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runInvitationGet } = await import('./commands/invitation.js');
          await runInvitationGet(argv.id, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'send',
        'Send an invitation',
        (y) =>
          y.options({
            email: { type: 'string', demandOption: true, describe: 'Email address to invite' },
            org: { type: 'string', describe: 'Organization ID (org_*)' },
            role: { type: 'string', describe: 'Role ID (role_*) to assign on acceptance' },
            'expires-in-days': { type: 'number', describe: 'Expiration in days (default 7)' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runInvitationSend } = await import('./commands/invitation.js');
          await runInvitationSend({
            email: argv.email,
            org: argv.org,
            role: argv.role,
            expiresInDays: argv.expiresInDays,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'revoke <id>',
        'Revoke an invitation',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Invitation ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runInvitationRevoke } = await import('./commands/invitation.js');
          await runInvitationRevoke(argv.id, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'resend <id>',
        'Resend an invitation',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true, describe: 'Invitation ID' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runInvitationResend } = await import('./commands/invitation.js');
          await runInvitationResend(argv.id, { environmentId: argv.environmentId as string | undefined });
        },
      );
      return yargs.demandCommand(1, 'Please specify an invitation subcommand').strict();
    })
    .command('session', 'Manage user sessions', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'list <userId>',
        'List sessions for a user',
        (y) =>
          y.positional('userId', { type: 'string', demandOption: true, describe: 'User ID (user_*)' }).options({
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runSessionList } = await import('./commands/session.js');
          await runSessionList(argv.userId, {
            limit: argv.limit,
            before: argv.before,
            after: argv.after,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'revoke <sessionId>',
        'Revoke a session',
        (y) =>
          y
            .positional('sessionId', { type: 'string', demandOption: true, describe: 'Session ID' })
            .option('yes', { alias: 'y', type: 'boolean', default: false, describe: 'Skip the confirmation prompt' })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runSessionRevoke } = await import('./commands/session.js');
          await runSessionRevoke(argv.sessionId, {
            yes: argv.yes,
            json: argv.json as boolean | undefined,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a session subcommand').strict();
    })
    .command('connection', 'Manage SSO connections (read/delete)', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'list',
        'List connections',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'get <id>',
        'Get a connection',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runConnectionGet } = await import('./commands/connection.js');
          await runConnectionGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete a connection',
        (y) =>
          y
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
      );
      return yargs.demandCommand(1, 'Please specify a connection subcommand').strict();
    })
    .command('directory', 'Manage directory sync (read/delete, list users/groups)', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'list',
        'List directories',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'get <id>',
        'Get a directory',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runDirectoryGet } = await import('./commands/directory.js');
          await runDirectoryGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete a directory',
        (y) =>
          y
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
      );
      registerSubcommand(
        yargs,
        'list-users',
        'List directory users',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'list-groups',
        'List directory groups',
        (y) =>
          y.options({
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
      );
      return yargs.demandCommand(1, 'Please specify a directory subcommand').strict();
    })
    .command('event', 'Query WorkOS events', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'list',
        'List events',
        (y) =>
          y.options({
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
      );
      return yargs.demandCommand(1, 'Please specify an event subcommand').strict();
    })
    .command('audit-log', 'Manage audit logs', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'create-event <orgId>',
        'Create an audit log event',
        (y) =>
          y.positional('orgId', { type: 'string', demandOption: true }).options({
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
      );
      registerSubcommand(
        yargs,
        'export',
        'Export audit logs',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'list-actions',
        'List available audit log actions',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogListActions } = await import('./commands/audit-log.js');
          await runAuditLogListActions(resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'get-schema <action>',
        'Get schema for an audit log action',
        (y) => y.positional('action', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogGetSchema } = await import('./commands/audit-log.js');
          await runAuditLogGetSchema(argv.action, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'create-schema <action>',
        'Create an audit log schema',
        (y) =>
          y
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
      );
      registerSubcommand(
        yargs,
        'get-retention <orgId>',
        'Get audit log retention period',
        (y) => y.positional('orgId', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runAuditLogGetRetention } = await import('./commands/audit-log.js');
          await runAuditLogGetRetention(argv.orgId, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      return yargs.demandCommand(1, 'Please specify an audit-log subcommand').strict();
    })
    .command('feature-flag', 'Manage feature flags', (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'list',
        'List feature flags',
        (y) =>
          y.options({
            limit: { type: 'number', describe: 'Limit number of results' },
            before: { type: 'string', describe: 'Cursor for results before a specific item' },
            after: { type: 'string', describe: 'Cursor for results after a specific item' },
            order: { type: 'string', describe: 'Order of results, asc or desc' },
            'environment-id': { type: 'string', describe: 'Environment ID (defaults to the active environment)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runFeatureFlagList } = await import('./commands/feature-flag.js');
          await runFeatureFlagList({
            limit: argv.limit,
            before: argv.before,
            after: argv.after,
            order: argv.order,
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'get <slug>',
        'Get a feature flag',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runFeatureFlagGet } = await import('./commands/feature-flag.js');
          await runFeatureFlagGet(argv.slug, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'enable <slug>',
        'Enable a feature flag',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runFeatureFlagEnable } = await import('./commands/feature-flag.js');
          await runFeatureFlagEnable(argv.slug, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'disable <slug>',
        'Disable a feature flag',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runFeatureFlagDisable } = await import('./commands/feature-flag.js');
          await runFeatureFlagDisable(argv.slug, { environmentId: argv.environmentId as string | undefined });
        },
      );
      registerSubcommand(
        yargs,
        'add-target <slug> <targetId>',
        'Add a target (user_* or org_*) to a feature flag',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .positional('targetId', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runFeatureFlagAddTarget } = await import('./commands/feature-flag.js');
          await runFeatureFlagAddTarget(argv.slug, argv.targetId, {
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      registerSubcommand(
        yargs,
        'remove-target <slug> <targetId>',
        'Remove a target (user_* or org_*) from a feature flag',
        (y) =>
          y
            .positional('slug', { type: 'string', demandOption: true })
            .positional('targetId', { type: 'string', demandOption: true })
            .option('environment-id', { type: 'string', describe: 'Environment ID (defaults to the active environment)' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runFeatureFlagRemoveTarget } = await import('./commands/feature-flag.js');
          await runFeatureFlagRemoveTarget(argv.slug, argv.targetId, {
            environmentId: argv.environmentId as string | undefined,
          });
        },
      );
      return yargs.demandCommand(1, 'Please specify a feature-flag subcommand').strict();
    })
    .command('webhook', 'Manage webhooks', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'list',
        'List webhooks',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runWebhookList } = await import('./commands/webhook.js');
          await runWebhookList(resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'create',
        'Create a webhook',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete a webhook',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runWebhookDelete } = await import('./commands/webhook.js');
          await runWebhookDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      return yargs.demandCommand(1, 'Please specify a webhook subcommand').strict();
    })
    .command('config', 'Manage WorkOS configuration (redirect URIs, CORS, homepage)', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      yargs.command('redirect', 'Manage redirect URIs', (yargs) => {
        registerSubcommand(
          yargs,
          'add <uri>',
          'Add a redirect URI',
          (y) => y.positional('uri', { type: 'string', demandOption: true }),
          async (argv) => {
            await applyInsecureStorage(argv.insecureStorage);

            const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
            const { runConfigRedirectAdd } = await import('./commands/config.js');
            await runConfigRedirectAdd(argv.uri, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
          },
        );
        return yargs.demandCommand(1).strict();
      });
      yargs.command('cors', 'Manage CORS origins', (yargs) => {
        registerSubcommand(
          yargs,
          'add <origin>',
          'Add a CORS origin',
          (y) => y.positional('origin', { type: 'string', demandOption: true }),
          async (argv) => {
            await applyInsecureStorage(argv.insecureStorage);

            const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
            const { runConfigCorsAdd } = await import('./commands/config.js');
            await runConfigCorsAdd(argv.origin, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
          },
        );
        return yargs.demandCommand(1).strict();
      });
      yargs.command('homepage-url', 'Manage homepage URL', (yargs) => {
        registerSubcommand(
          yargs,
          'set <url>',
          'Set the homepage URL',
          (y) => y.positional('url', { type: 'string', demandOption: true }),
          async (argv) => {
            await applyInsecureStorage(argv.insecureStorage);

            const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
            const { runConfigHomepageUrlSet } = await import('./commands/config.js');
            await runConfigHomepageUrlSet(argv.url, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
          },
        );
        return yargs.demandCommand(1).strict();
      });
      return yargs.demandCommand(1, 'Please specify a config subcommand').strict();
    })
    .command('portal', 'Manage Admin Portal', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'generate-link',
        'Generate an Admin Portal link',
        (y) =>
          y.options({
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
      );
      return yargs.demandCommand(1, 'Please specify a portal subcommand').strict();
    })
    .command('vault', 'Manage WorkOS Vault secrets', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'list',
        'List vault objects',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'get <id>',
        'Get a vault object (metadata only; use --decrypt to include value)',
        (y) =>
          y
            .positional('id', { type: 'string', demandOption: true })
            .option('decrypt', { type: 'boolean', default: false, describe: 'Include the decrypted secret value' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultGet } = await import('./commands/vault.js');
          await runVaultGet(argv.id, argv.decrypt, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'get-by-name <name>',
        'Get a vault object by name (metadata only; use --decrypt to include value)',
        (y) =>
          y
            .positional('name', { type: 'string', demandOption: true })
            .option('decrypt', { type: 'boolean', default: false, describe: 'Include the decrypted secret value' }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultGetByName } = await import('./commands/vault.js');
          await runVaultGetByName(argv.name, argv.decrypt, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'create',
        'Create a vault object (reads value from stdin when --value is omitted or -)',
        (y) =>
          y.options({
            name: { type: 'string', demandOption: true },
            value: { type: 'string', describe: 'Secret value (omit or use - to read from stdin)' },
            org: { type: 'string', demandOption: true, describe: 'Organization ID (required for key context)' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultCreate, readValueFromStdin } = await import('./commands/vault.js');
          const value = argv.value === undefined || argv.value === '-' ? await readValueFromStdin() : argv.value;
          await runVaultCreate(
            { name: argv.name, value, org: argv.org },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      );
      registerSubcommand(
        yargs,
        'update <id>',
        'Update a vault object (reads value from stdin when --value is omitted or -)',
        (y) =>
          y.positional('id', { type: 'string', demandOption: true }).options({
            value: { type: 'string', describe: 'New value (omit or use - to read from stdin)' },
            'version-check': { type: 'string' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultUpdate, readValueFromStdin } = await import('./commands/vault.js');
          const value = argv.value === undefined || argv.value === '-' ? await readValueFromStdin() : argv.value;
          await runVaultUpdate(
            { id: argv.id, value, versionCheck: argv.versionCheck },
            resolveApiKey({ apiKey: argv.apiKey }),
            resolveApiBaseUrl(),
          );
        },
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete a vault object',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultDelete } = await import('./commands/vault.js');
          await runVaultDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'describe <id>',
        'Describe a vault object',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultDescribe } = await import('./commands/vault.js');
          await runVaultDescribe(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'list-versions <id>',
        'List vault object versions',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runVaultListVersions } = await import('./commands/vault.js');
          await runVaultListVersions(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'run',
        'Run a command with Vault secrets injected as environment variables',
        (y) =>
          y.options({
            secret: {
              type: 'string',
              array: true,
              describe: 'Map a vault object to an env var: ENV_VAR=vault-name (repeatable)',
              demandOption: true,
            },
            env: { type: 'string', describe: 'Environment name to read API key from (defaults to active)' },
            'dry-run': { type: 'boolean', default: false, describe: 'Print which secrets would be injected, no fetch' },
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { runVaultRun } = await import('./commands/vault-run.js');
          const childCommand = (argv['--'] as string[] | undefined) ?? [];
          const exitCode = await runVaultRun(
            {
              secrets: argv.secret as string[],
              command: childCommand,
              env: argv.env,
              dryRun: argv.dryRun,
            },
            argv.apiKey as string | undefined,
          );
          if (typeof exitCode === 'number') process.exit(exitCode);
        },
      );
      return yargs.demandCommand(1, 'Please specify a vault subcommand').strict();
    })
    .command('api-key', 'Manage API keys', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'list',
        'List API keys',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'create',
        'Create an API key',
        (y) =>
          y.options({
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
      );
      registerSubcommand(
        yargs,
        'validate <value>',
        'Validate an API key',
        (y) => y.positional('value', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runApiKeyValidate } = await import('./commands/api-key-mgmt.js');
          await runApiKeyValidate(argv.value, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete an API key',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runApiKeyDelete } = await import('./commands/api-key-mgmt.js');
          await runApiKeyDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      return yargs.demandCommand(1, 'Please specify an api-key subcommand').strict();
    })
    .command('org-domain', 'Manage organization domains', (yargs) => {
      yargs.options({ ...insecureStorageOption, 'api-key': { type: 'string' as const, describe: 'WorkOS API key' } });
      registerSubcommand(
        yargs,
        'get <id>',
        'Get a domain',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainGet } = await import('./commands/org-domain.js');
          await runOrgDomainGet(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'create <domain>',
        'Create a domain',
        (y) =>
          y
            .positional('domain', { type: 'string', demandOption: true })
            .option('org', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainCreate } = await import('./commands/org-domain.js');
          await runOrgDomainCreate(argv.domain, argv.org, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'verify <id>',
        'Verify a domain',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainVerify } = await import('./commands/org-domain.js');
          await runOrgDomainVerify(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      registerSubcommand(
        yargs,
        'delete <id>',
        'Delete a domain',
        (y) => y.positional('id', { type: 'string', demandOption: true }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);

          const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
          const { runOrgDomainDelete } = await import('./commands/org-domain.js');
          await runOrgDomainDelete(argv.id, resolveApiKey({ apiKey: argv.apiKey }), resolveApiBaseUrl());
        },
      );
      return yargs.demandCommand(1, 'Please specify an org-domain subcommand').strict();
    })
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
          init: { type: 'boolean', default: false, describe: 'Create an example workos-seed.yml file' },
        }),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage);
        const { resolveApiKey, resolveApiBaseUrl } = await import('./lib/api-key.js');
        const { runSeed } = await import('./commands/seed.js');
        await runSeed(
          { file: argv.file, clean: argv.clean, init: argv.init },
          resolveApiKey({ apiKey: argv.apiKey }),
          resolveApiBaseUrl(),
        );
      },
    )
    .command(
      'setup',
      'Set up your coding agent (install WorkOS skills + MCP server)',
      (yargs) =>
        yargs.options({
          ...insecureStorageOption,
          agents: { type: 'string', describe: 'Comma-separated agent keys (claude-code, codex, cursor, goose)' },
          'skills-only': { type: 'boolean', describe: 'Install skills only (skip the MCP server)' },
          'mcp-only': { type: 'boolean', describe: 'Install the MCP server only (skip skills)' },
          yes: { type: 'boolean', alias: 'y', describe: 'Install without prompting' },
          reset: { type: 'boolean', describe: 'Re-enable automatic setup offers after a decline' },
        }),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage as boolean | undefined);
        const { runSetup } = await import('./commands/setup.js');
        await runSetup({
          trigger: 'command',
          agents: argv.agents
            ? String(argv.agents)
                .split(',')
                .map((a) => a.trim())
                .filter(Boolean)
            : undefined,
          skillsOnly: argv.skillsOnly as boolean | undefined,
          mcpOnly: argv.mcpOnly as boolean | undefined,
          assumeYes: argv.yes as boolean | undefined,
          reset: argv.reset as boolean | undefined,
        });
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
    // Alias — canonical command is `workos env claim`
    .command(
      'claim',
      'Claim an unclaimed WorkOS environment — link it to your account (permanent — cannot be undone)',
      (yargs) =>
        yargs.options({
          ...insecureStorageOption,
        }),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage);
        const { runClaim } = await import('./commands/claim.js');
        await runClaim();
      },
    )
    .command(
      'install',
      'Install WorkOS AuthKit into your project (interactive framework detection and setup)',
      (yargs) => yargs.options(installerOptions),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage);
        // MUST run before credential resolution below: that provisions a WorkOS
        // environment and writes its credentials into the project's env file,
        // so a guard placed after it is no guard at all.
        const preflight = await import('./lib/preflight-authkit.js');
        await preflight.assertNoExistingAuthKit({ installDir: argv.installDir ?? process.cwd(), force: argv.force });
        await resolveInstallCredentials(argv.apiKey, argv.installDir, argv.skipAuth, ensureAuthenticated);
        const { handleInstall } = await import('./commands/install.js');
        await handleInstall(argv);
      },
    )
    .command(
      'dev',
      false, // Hidden: unreleased beta feature
      (yargs) =>
        yargs.options({
          port: { type: 'number', default: 4100, describe: 'Emulator port' },
          seed: { type: 'string', describe: 'Path to seed config file' },
        }),
      async (argv) => {
        const { runDev } = await import('./commands/dev.js');
        await runDev({
          port: argv.port,
          seed: argv.seed,
          '--': argv['--'] as string[] | undefined,
        });
      },
    )
    .command(
      'emulate',
      'Start a local WorkOS API emulator',
      (yargs) =>
        yargs.options({
          port: {
            alias: 'p',
            type: 'number',
            default: 4100,
            describe: 'Port to listen on',
          },
          seed: {
            alias: 's',
            type: 'string',
            describe: 'Path to seed config file (YAML or JSON)',
          },
          interactive: {
            alias: 'i',
            type: 'boolean',
            default: false,
            describe: 'Show login pages for SSO/AuthKit',
          },
        }),
      async (argv) => {
        const { runEmulate } = await import('./commands/emulate.js');
        await runEmulate({
          port: argv.port,
          seed: argv.seed,
          json: argv.json as boolean,
          interactive: argv.interactive,
        });
      },
    )
    .command('debug', false, (yargs) => {
      yargs.options(insecureStorageOption);
      registerSubcommand(
        yargs,
        'state',
        'Dump raw CLI state (credentials, config, storage)',
        (y) =>
          y.option('show-secrets', {
            type: 'boolean',
            default: false,
            describe: 'Show unredacted tokens and API keys',
          }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runDebugState } = await import('./commands/debug.js');
          await runDebugState({ showSecrets: argv.showSecrets as boolean });
        },
      );
      registerSubcommand(
        yargs,
        'reset',
        'Clear auth state (keyring + files)',
        (y) =>
          y
            .option('force', {
              type: 'boolean',
              default: false,
              describe: 'Skip confirmation prompt',
            })
            .option('credentials-only', {
              type: 'boolean',
              default: false,
              describe: 'Only clear credentials',
            })
            .option('config-only', {
              type: 'boolean',
              default: false,
              describe: 'Only clear config',
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runDebugReset } = await import('./commands/debug.js');
          await runDebugReset({
            force: argv.force as boolean,
            credentialsOnly: argv.credentialsOnly as boolean,
            configOnly: argv.configOnly as boolean,
          });
        },
      );
      registerSubcommand(
        yargs,
        'simulate',
        'Simulate CLI states for testing',
        (y) =>
          y
            .option('expired-token', {
              type: 'boolean',
              default: false,
              describe: 'Set token expiresAt to the past',
            })
            .option('no-keyring', {
              type: 'boolean',
              default: false,
              describe: 'Force file-only storage mode',
            })
            .option('unclaimed', {
              type: 'boolean',
              default: false,
              describe: 'Write synthetic unclaimed environment',
            })
            .option('no-auth', {
              type: 'boolean',
              default: false,
              describe: 'Clear credentials, keep config',
            })
            .option('crash', {
              type: 'boolean',
              default: false,
              describe: 'Throw an unexpected error to exercise the crash-telemetry path',
            }),
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runDebugSimulate } = await import('./commands/debug.js');
          await runDebugSimulate({
            expiredToken: argv.expiredToken as boolean,
            noKeyring: argv.noKeyring as boolean,
            unclaimed: argv.unclaimed as boolean,
            noAuth: argv.noAuth as boolean,
            crash: argv.crash as boolean,
          });
        },
      );
      registerSubcommand(
        yargs,
        'env',
        'Show WORKOS_* environment variables and their effects',
        (y) => y,
        async () => {
          const { runDebugEnv } = await import('./commands/debug.js');
          await runDebugEnv();
        },
      );
      registerSubcommand(
        yargs,
        'token',
        'Decode and inspect the current access token',
        (y) => y,
        async (argv) => {
          await applyInsecureStorage(argv.insecureStorage);
          const { runDebugToken } = await import('./commands/debug.js');
          await runDebugToken();
        },
      );
      return yargs.demandCommand(1, `Run "${getWorkOSCommand()} debug <command>" for debug tools.`).strict();
    })
    .command('internal', false, (yargs) => {
      registerSubcommand(
        yargs,
        'verify-assets',
        'Verify embedded assets (skills, Agent SDK) extract and run on this machine',
        (y) => y,
        async () => {
          const { runVerifyAssets } = await import('./commands/internal-verify-assets.js');
          await runVerifyAssets();
        },
      );
      return yargs.demandCommand(1, 'Run "workos internal <command>" for internal tools.').strict();
    })
    .command(
      'migrations',
      MIGRATIONS_DESCRIPTION,
      (yargs) =>
        yargs
          .strictCommands(false)
          .strict(false)
          .help(false)
          .version(false)
          .options({
            ...insecureStorageOption,
            'api-key': { type: 'string' as const, describe: 'WorkOS API key' },
          }),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage);
        const { resolveOptionalApiKey } = await import('./lib/api-key.js');
        const { getActiveEnvironment } = await import('./lib/config-store.js');
        const { getMigrationsPassthroughArgs, runMigrations } = await import('./commands/migrations.js');
        const passthrough = getMigrationsPassthroughArgs(rawArgs);
        const endpoint = getActiveEnvironment()?.endpoint;
        await runMigrations(passthrough, resolveOptionalApiKey({ apiKey: argv.apiKey }), endpoint);
      },
    )
    .command(
      'dashboard',
      false, // hidden from help
      (yargs) => yargs.options(installerOptions),
      async (argv) => {
        await applyInsecureStorage(argv.insecureStorage);
        // Guard first, before credential resolution — see the `install` handler above.
        const preflight = await import('./lib/preflight-authkit.js');
        await preflight.assertNoExistingAuthKit({ installDir: argv.installDir ?? process.cwd(), force: argv.force });
        await resolveInstallCredentials(argv.apiKey, argv.installDir, argv.skipAuth, ensureAuthenticated);
        const { handleInstall } = await import('./commands/install.js');
        await handleInstall({ ...argv, dashboard: true });
      },
    )
    .command(
      ['$0'],
      'WorkOS AuthKit CLI',
      // `--force` must be registered here too: this parser is .strict(), so
      // `npx workos --force` would die as an unknown argument otherwise.
      (yargs) => yargs.options({ ...insecureStorageOption, ...forceOption }),
      async (argv) => {
        // Non-human modes: emit machine-readable command tree (JSON) or the
        // fully-configured parser help (human non-TTY edge) instead of prompting.
        if (!isPromptAllowed()) {
          if (isJsonMode()) {
            const { buildCommandTree } = await import('./utils/help-json.js');
            outputJson(buildCommandTree());
          } else {
            parser.showHelp();
          }
          return;
        }

        // TTY: ask if user wants to run installer
        const shouldInstall = await ui.confirm({
          message: 'Run the AuthKit installer?',
        });

        if (ui.isCancel(shouldInstall) || !shouldInstall) {
          return;
        }

        await applyInsecureStorage(argv.insecureStorage);
        // After the confirm above (two prompts back to back is worse UX), but
        // still before credential resolution touches the project.
        const preflight = await import('./lib/preflight-authkit.js');
        await preflight.assertNoExistingAuthKit({ installDir: process.cwd(), force: argv.force });
        await resolveInstallCredentials(undefined, undefined, false, ensureAuthenticated);

        const { handleInstall } = await import('./commands/install.js');
        await handleInstall({ ...argv, dashboard: false });
      },
    )
    .strict()
    .help()
    .alias('help', 'h')
    .version(getVersion())
    .alias('version', 'v')
    .wrap(process.stdout.isTTY && process.stdout.columns ? process.stdout.columns : 80);

  const shouldSkipTelemetry = () => !isTelemetryEnabled() || SKIP_TELEMETRY_COMMANDS.has(commandName.split('.')[0]);
  let commandOutcome:
    | {
        success: boolean;
        options: Parameters<typeof analytics.emitCommandEvent>[3];
      }
    | undefined;

  try {
    await parser.parseAsync(rawArgs);

    process.exitCode = 0;
    commandOutcome = {
      success: true,
      options: {
        flags,
        reason: 'success',
      },
    };
  } catch (error) {
    if (error instanceof CliExit) {
      process.exitCode = error.exitCode;
      commandOutcome = {
        success: error.exitCode === 0,
        options: {
          flags,
          reason: error.context?.reason,
          errorCode: error.context?.errorCode,
          apiContext: error.context?.apiContext,
        },
      };
    } else if (error instanceof PromptUnavailableError) {
      // A prompt was attempted where the user can't answer (--json, or non-TTY
      // stdin) on a direct command. Not a crash — surface a clear, structured
      // error with its own code so scripts and telemetry can distinguish it.
      process.exitCode = 1;
      commandOutcome = {
        success: false,
        options: { flags, reason: 'validation_error', errorCode: 'prompt_unavailable' },
      };
      outputError({ code: 'prompt_unavailable', message: error.message });
    } else {
      // Unexpected error (crash)
      process.exitCode = 1;
      const err = error instanceof Error ? error : new Error(String(error));
      commandOutcome = {
        success: false,
        options: {
          flags,
          reason: 'crash',
          error: err,
        },
      };
      analytics.captureUnhandledCrash(err, { command: commandName });
      // Don't exit silently on an unexpected error. Surface a sanitized
      // message (secrets/paths stripped) so the user gets a diagnostic instead
      // of a bare exit code 1. Full details are in the crash log / telemetry.
      outputError({ code: 'internal_error', message: sanitizeMessage(err.message) });
    }
  } finally {
    if (commandOutcome && !shouldSkipTelemetry()) {
      analytics.emitCommandEvent(commandName, Date.now() - startTime, commandOutcome.success, commandOutcome.options);
    }
    await telemetryClient.flush().catch(() => {});
  }
}

runCli();
