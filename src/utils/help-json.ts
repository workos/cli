/**
 * Agent-discoverable help: machine-readable command tree for --help --json.
 *
 * Static command registry mirroring bin.ts yargs definitions.
 * yargs v18 doesn't expose public APIs for command introspection,
 * so we maintain a parallel typed registry.
 */

import { getVersion } from '../lib/settings.js';

export interface OptionSchema {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
  alias?: string;
  choices?: string[];
  hidden: boolean;
}

export interface PositionalSchema {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface CommandSchema {
  name: string;
  description: string;
  commands?: CommandSchema[];
  options?: OptionSchema[];
  positionals?: PositionalSchema[];
  examples?: string[];
}

export interface HelpOutput {
  name: string;
  version: string;
  description: string;
  commands: CommandSchema[];
  options: OptionSchema[];
}

// ---------------------------------------------------------------------------
// Shared option fragments (mirrors bin.ts shared option objects)
// ---------------------------------------------------------------------------

const insecureStorageOpt: OptionSchema = {
  name: 'insecure-storage',
  type: 'boolean',
  description: 'Store credentials in plaintext file instead of system keyring',
  required: false,
  default: false,
  hidden: false,
};

const apiKeyOpt: OptionSchema = {
  name: 'api-key',
  type: 'string',
  description: 'WorkOS API key (overrides environment config). Format: sk_live_* or sk_test_*',
  required: false,
  hidden: false,
};

const paginationOpts: OptionSchema[] = [
  { name: 'limit', type: 'number', description: 'Maximum number of results to return', required: false, hidden: false },
  {
    name: 'before',
    type: 'string',
    description: 'Pagination cursor for results before a specific item',
    required: false,
    hidden: false,
  },
  {
    name: 'after',
    type: 'string',
    description: 'Pagination cursor for results after a specific item',
    required: false,
    hidden: false,
  },
  {
    name: 'order',
    type: 'string',
    description: 'Sort order (asc or desc)',
    required: false,
    choices: ['asc', 'desc'],
    hidden: false,
  },
];

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

const commands: CommandSchema[] = [
  {
    name: 'login',
    description: 'Authenticate with WorkOS via browser-based OAuth',
    options: [insecureStorageOpt],
  },
  {
    name: 'logout',
    description: 'Remove stored WorkOS credentials and tokens',
    options: [insecureStorageOpt],
  },
  {
    name: 'install-skill',
    description: 'Install bundled AuthKit skills to coding agents (Claude Code, Codex, Cursor, Goose)',
    options: [
      {
        name: 'list',
        type: 'boolean',
        description: 'List available skills without installing',
        required: false,
        alias: 'l',
        hidden: false,
      },
      {
        name: 'skill',
        type: 'array',
        description: 'Install specific skill(s) by name',
        required: false,
        alias: 's',
        hidden: false,
      },
      {
        name: 'agent',
        type: 'array',
        description: 'Target specific agent(s): claude-code, codex, cursor, goose',
        required: false,
        alias: 'a',
        hidden: false,
      },
    ],
  },
  {
    name: 'doctor',
    description: 'Diagnose WorkOS AuthKit integration issues in the current project',
    options: [
      {
        name: 'verbose',
        type: 'boolean',
        description: 'Include additional diagnostic information',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'skip-api',
        type: 'boolean',
        description: 'Skip API calls (offline mode)',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'skip-ai',
        type: 'boolean',
        description: 'Skip AI-powered analysis',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'install-dir',
        type: 'string',
        description: 'Project directory to analyze (defaults to cwd)',
        required: false,
        hidden: false,
      },
      {
        name: 'json',
        type: 'boolean',
        description: 'Output diagnostic report as JSON',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'copy',
        type: 'boolean',
        description: 'Copy diagnostic report to clipboard',
        required: false,
        default: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'env',
    description: 'Manage environment configurations (API keys, endpoints, active environment)',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'add',
        description: 'Add a new environment configuration with API key and optional settings',
        positionals: [
          {
            name: 'name',
            type: 'string',
            description: 'Environment name (lowercase, hyphens, underscores)',
            required: false,
          },
          { name: 'apiKey', type: 'string', description: 'WorkOS API key (sk_live_* or sk_test_*)', required: false },
        ],
        options: [
          {
            name: 'client-id',
            type: 'string',
            description: 'WorkOS client ID for this environment',
            required: false,
            hidden: false,
          },
          { name: 'endpoint', type: 'string', description: 'Custom API endpoint URL', required: false, hidden: false },
        ],
      },
      {
        name: 'remove',
        description: 'Remove an environment configuration',
        positionals: [{ name: 'name', type: 'string', description: 'Environment name to remove', required: true }],
      },
      {
        name: 'switch',
        description: 'Switch the active environment (determines which API key is used)',
        positionals: [{ name: 'name', type: 'string', description: 'Environment name to activate', required: false }],
      },
      {
        name: 'list',
        description: 'List all configured environments and show which is active',
      },
    ],
  },
  {
    name: 'organization',
    description: 'Manage WorkOS organizations (create, update, get, list, delete)',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'create',
        description: 'Create a new organization with optional verified domains',
        positionals: [
          { name: 'name', type: 'string', description: 'Organization name', required: true },
          {
            name: 'domains',
            type: 'string',
            description: 'Domains in format domain:state (state defaults to verified)',
            required: false,
          },
        ],
      },
      {
        name: 'update',
        description: 'Update an existing organization name or domain',
        positionals: [
          { name: 'orgId', type: 'string', description: 'Organization ID (org_*)', required: true },
          { name: 'name', type: 'string', description: 'New organization name', required: true },
          { name: 'domain', type: 'string', description: 'Domain to add or update', required: false },
          { name: 'state', type: 'string', description: 'Domain state (verified or pending)', required: false },
        ],
      },
      {
        name: 'get',
        description: 'Get an organization by its ID',
        positionals: [{ name: 'orgId', type: 'string', description: 'Organization ID (org_*)', required: true }],
      },
      {
        name: 'list',
        description: 'List organizations with optional filters and pagination',
        options: [
          {
            name: 'domain',
            type: 'string',
            description: 'Filter organizations by domain',
            required: false,
            hidden: false,
          },
          ...paginationOpts,
        ],
      },
      {
        name: 'delete',
        description: 'Delete an organization by its ID',
        positionals: [{ name: 'orgId', type: 'string', description: 'Organization ID (org_*)', required: true }],
      },
    ],
  },
  {
    name: 'user',
    description: 'Manage WorkOS user management users (get, list, update, delete)',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'get',
        description: 'Get a user by their ID',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
      },
      {
        name: 'list',
        description: 'List users with optional filters and pagination',
        options: [
          {
            name: 'email',
            type: 'string',
            description: 'Filter users by email address',
            required: false,
            hidden: false,
          },
          {
            name: 'organization',
            type: 'string',
            description: 'Filter users by organization ID',
            required: false,
            hidden: false,
          },
          ...paginationOpts,
        ],
      },
      {
        name: 'update',
        description: 'Update user properties (name, email verification, password, external ID)',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
        options: [
          { name: 'first-name', type: 'string', description: 'First name', required: false, hidden: false },
          { name: 'last-name', type: 'string', description: 'Last name', required: false, hidden: false },
          {
            name: 'email-verified',
            type: 'boolean',
            description: 'Email verification status',
            required: false,
            hidden: false,
          },
          { name: 'password', type: 'string', description: 'New password', required: false, hidden: false },
          {
            name: 'external-id',
            type: 'string',
            description: 'External ID for cross-system mapping',
            required: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a user by their ID',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
      },
    ],
  },
  {
    name: 'install',
    description: 'Install WorkOS AuthKit into your project (interactive framework detection and setup)',
    options: [
      {
        name: 'direct',
        type: 'boolean',
        description: 'Use your own Anthropic API key (bypass llm-gateway)',
        required: false,
        default: false,
        alias: 'D',
        hidden: false,
      },
      {
        name: 'debug',
        type: 'boolean',
        description: 'Enable verbose logging',
        required: false,
        default: false,
        hidden: false,
      },
      insecureStorageOpt,
      {
        name: 'homepage-url',
        type: 'string',
        description: 'App homepage URL for WorkOS (defaults to http://localhost:{port})',
        required: false,
        hidden: false,
      },
      {
        name: 'redirect-uri',
        type: 'string',
        description: 'Redirect URI for WorkOS callback (defaults to framework convention)',
        required: false,
        hidden: false,
      },
      {
        name: 'validate',
        type: 'boolean',
        description: 'Run post-installation validation (use --no-validate to skip)',
        required: false,
        default: true,
        hidden: false,
      },
      {
        name: 'install-dir',
        type: 'string',
        description: 'Directory to install WorkOS AuthKit in (defaults to cwd)',
        required: false,
        hidden: false,
      },
      {
        name: 'integration',
        type: 'string',
        description: 'Framework integration to set up (auto-detected if omitted)',
        required: false,
        hidden: false,
      },
      {
        name: 'force-install',
        type: 'boolean',
        description: 'Force install packages even if peer dependency checks fail',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'dashboard',
        type: 'boolean',
        description: 'Run with visual dashboard mode',
        required: false,
        default: false,
        alias: 'd',
        hidden: false,
      },
      {
        name: 'branch',
        type: 'boolean',
        description: 'Create a new branch for changes (use --no-branch to skip)',
        required: false,
        default: true,
        hidden: false,
      },
      {
        name: 'commit',
        type: 'boolean',
        description: 'Auto-commit after installation (use --no-commit to skip)',
        required: false,
        default: true,
        hidden: false,
      },
      {
        name: 'create-pr',
        type: 'boolean',
        description: 'Auto-create pull request after installation',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'git-check',
        type: 'boolean',
        description: 'Check for dirty working tree (use --no-git-check to skip)',
        required: false,
        default: true,
        hidden: false,
      },
    ],
  },
];

const globalOptions: OptionSchema[] = [
  {
    name: 'json',
    type: 'boolean',
    description: 'Output results as JSON (auto-enabled in non-TTY environments)',
    required: false,
    default: false,
    hidden: false,
  },
  { name: 'help', type: 'boolean', description: 'Show help', required: false, alias: 'h', hidden: false },
  { name: 'version', type: 'boolean', description: 'Show version number', required: false, alias: 'v', hidden: false },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a machine-readable command tree for --help --json output.
 *
 * @param subcommand - Optional command name to return a subtree for (e.g. "env").
 *                     Returns full tree if omitted or if command not found.
 */
export function buildCommandTree(subcommand?: string): HelpOutput | CommandSchema {
  if (subcommand) {
    const match = commands.find((c) => c.name === subcommand);
    if (match) return match;
  }

  return {
    name: 'workos',
    version: getVersion(),
    description: 'WorkOS CLI for AuthKit integration and resource management',
    commands,
    options: globalOptions,
  };
}
