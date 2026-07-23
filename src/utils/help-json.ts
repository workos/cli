/**
 * Agent-discoverable help: machine-readable command tree for --help --json.
 *
 * Static command registry mirroring bin.ts yargs definitions.
 * yargs v18 doesn't expose public APIs for command introspection,
 * so we maintain a parallel typed registry.
 */

import { getVersion } from '../lib/settings.js';
import { COMMAND_ALIASES } from '../lib/command-aliases.js';
import { MIGRATIONS_DESCRIPTION } from '../lib/constants.js';

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

const environmentIdOpt: OptionSchema = {
  name: 'environment-id',
  type: 'string',
  description: 'Environment ID (defaults to the active environment)',
  required: false,
  hidden: false,
};

const confirmYesOpt: OptionSchema = {
  name: 'yes',
  type: 'boolean',
  description: 'Skip the confirmation prompt',
  required: false,
  default: false,
  alias: 'y',
  hidden: false,
};

// require-flag ops never prompt interactively (see `requireConfirmationFlag`);
// the flag only gates non-interactive callers, so the copy differs from the
// destructive-prompt `confirmYesOpt`. Matches `team change-role`/`set-mfa`.
const requireFlagYesOpt: OptionSchema = {
  name: 'yes',
  type: 'boolean',
  description: 'Confirm in non-interactive mode',
  required: false,
  default: false,
  alias: 'y',
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
    name: 'auth login',
    description: 'Authenticate with WorkOS via browser-based OAuth',
    options: [insecureStorageOpt],
  },
  {
    name: 'auth logout',
    description: 'Remove stored WorkOS credentials and tokens',
    options: [insecureStorageOpt],
  },
  {
    name: 'auth status',
    description: 'Show current authentication status',
    options: [insecureStorageOpt],
  },
  {
    name: 'whoami',
    description: 'Show the authenticated user, team, and environment (dashboard session)',
    options: [
      insecureStorageOpt,
      {
        name: 'environment-id',
        type: 'string',
        description: 'Environment ID to target (defaults to the active environment)',
        required: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'environment',
    description: 'Manage WorkOS environments (create, rename) on the dashboard account plane',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'create',
        description: 'Create a sandbox or production environment',
        positionals: [{ name: 'name', type: 'string', description: 'Environment name', required: true }],
        options: [
          {
            name: 'sandbox',
            type: 'boolean',
            description: 'Create a sandbox environment',
            required: false,
            default: false,
            hidden: false,
          },
          {
            name: 'environment-id',
            type: 'string',
            description: 'Environment ID whose project receives the new environment (defaults to the active environment)',
            required: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'rename',
        description: 'Rename an environment',
        positionals: [
          { name: 'environmentId', type: 'string', description: 'Environment ID', required: true },
          { name: 'name', type: 'string', description: 'New environment name', required: true },
        ],
      },
    ],
  },
  {
    name: 'project',
    description: 'Manage WorkOS projects (create, rename, list) on the dashboard account plane',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'create',
        description: 'Create a project with fresh staging and production environments',
        positionals: [{ name: 'name', type: 'string', description: 'Project name', required: true }],
        options: [
          {
            name: 'production',
            type: 'boolean',
            description: 'Provision a production environment (use --no-production for staging only)',
            required: false,
            default: true,
            hidden: false,
          },
          {
            name: 'yes',
            type: 'boolean',
            description: 'Confirm in non-interactive mode',
            required: false,
            default: false,
            alias: 'y',
            hidden: false,
          },
        ],
      },
      {
        name: 'rename',
        description: 'Rename a project',
        positionals: [
          { name: 'projectId', type: 'string', description: 'Project ID', required: true },
          { name: 'name', type: 'string', description: 'New project name', required: true },
        ],
      },
      {
        name: 'list',
        description: 'List projects in the current team',
      },
    ],
  },
  {
    name: 'authkit',
    description: 'Manage AuthKit app config (redirect URIs, CORS, logout URIs, branding) on the dashboard account plane',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'redirect-uris',
        description: 'Manage AuthKit redirect URIs',
        commands: [
          {
            name: 'list',
            description: 'List configured redirect URIs for an environment',
            options: [
              { name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false },
              { name: 'limit', type: 'number', description: 'Maximum number of URIs to return', required: false, hidden: false },
            ],
          },
          {
            name: 'set',
            description: 'Set the allowed redirect URIs for an environment (replaces the full list)',
            options: [
              { name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false },
              { name: 'uri', type: 'string', description: 'Redirect URI (repeatable)', required: true, hidden: false },
              { name: 'default', type: 'string', description: 'Which URI to mark as the default', required: false, hidden: false },
              { name: 'dry-run', type: 'boolean', description: 'Validate without saving', required: false, default: false, hidden: false },
            ],
          },
        ],
      },
      {
        name: 'cors',
        description: 'Manage AuthKit CORS web origins',
        commands: [
          {
            name: 'get',
            description: 'Show the allowed web origins (CORS) for an environment',
            options: [{ name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false }],
          },
          {
            name: 'set',
            description: 'Set the allowed web origins (CORS) for an environment (replaces the full list)',
            options: [
              { name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false },
              { name: 'origin', type: 'string', description: 'Web origin (repeatable)', required: true, hidden: false },
              { name: 'dry-run', type: 'boolean', description: 'Validate without saving', required: false, default: false, hidden: false },
            ],
          },
        ],
      },
      {
        name: 'logout-uris',
        description: 'Manage AuthKit logout URIs',
        commands: [
          {
            name: 'list',
            description: 'List configured logout URIs for an environment',
            options: [
              { name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false },
              { name: 'limit', type: 'number', description: 'Maximum number of URIs to return', required: false, hidden: false },
            ],
          },
          {
            name: 'set',
            description: 'Set the allowed logout URIs for an environment (replaces the full list)',
            options: [
              { name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false },
              { name: 'uri', type: 'string', description: 'Logout URI (repeatable)', required: true, hidden: false },
              { name: 'default', type: 'string', description: 'Which URI to mark as the default', required: false, hidden: false },
              { name: 'dry-run', type: 'boolean', description: 'Validate without saving', required: false, default: false, hidden: false },
            ],
          },
        ],
      },
      {
        name: 'branding',
        description: 'Manage AuthKit branding',
        commands: [
          {
            name: 'get',
            description: 'Show AuthKit branding (logos, theme) for an environment',
            options: [{ name: 'environment-id', type: 'string', description: 'Environment ID (defaults to the active environment)', required: false, hidden: false }],
          },
        ],
      },
    ],
  },
  {
    name: 'team',
    description: 'Manage the WorkOS dashboard team (members, invites, settings)',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'members',
        description: 'List members of the current team',
      },
      {
        name: 'invite',
        description: 'Invite a user to the current team by email',
        positionals: [{ name: 'email', type: 'string', description: 'Email address to invite', required: true }],
        options: [
          { name: 'role', type: 'string', description: 'Role (ADMIN, MEMBER, ...)', required: true, hidden: false },
          { name: 'first-name', type: 'string', description: 'First name', required: false, hidden: false },
          { name: 'last-name', type: 'string', description: 'Last name', required: false, hidden: false },
        ],
      },
      {
        name: 'change-role',
        description: "Change a team member's role",
        positionals: [
          { name: 'membershipId', type: 'string', description: 'Team membership ID', required: true },
          { name: 'role', type: 'string', description: 'New role (ADMIN, MEMBER, ...)', required: true },
        ],
        options: [
          {
            name: 'yes',
            type: 'boolean',
            description: 'Confirm in non-interactive mode',
            required: false,
            default: false,
            alias: 'y',
            hidden: false,
          },
        ],
      },
      {
        name: 'remove',
        description: 'Remove a member from the current team',
        positionals: [{ name: 'membershipId', type: 'string', description: 'Team membership ID', required: true }],
        options: [
          {
            name: 'yes',
            type: 'boolean',
            description: 'Skip the confirmation prompt',
            required: false,
            default: false,
            alias: 'y',
            hidden: false,
          },
        ],
      },
      {
        name: 'resend-invite',
        description: 'Resend an expired team invitation',
        positionals: [{ name: 'membershipId', type: 'string', description: 'Team membership ID', required: true }],
      },
      {
        name: 'update',
        description: 'Rename the current team',
        positionals: [{ name: 'name', type: 'string', description: 'New team name', required: true }],
      },
      {
        name: 'set-mfa',
        description: 'Set whether MFA is required for the team',
        positionals: [
          { name: 'required', type: 'boolean', description: 'true to require MFA, false to relax', required: true },
        ],
        options: [
          {
            name: 'yes',
            type: 'boolean',
            description: 'Confirm in non-interactive mode',
            required: false,
            default: false,
            alias: 'y',
            hidden: false,
          },
        ],
      },
    ],
  },
  {
    name: 'telemetry',
    description: 'Manage telemetry collection (opt-out, opt-in, status)',
    commands: [
      { name: 'opt-out', description: 'Disable telemetry collection (persists across runs)' },
      { name: 'opt-in', description: 'Re-enable telemetry collection' },
      { name: 'status', description: 'Show whether telemetry is enabled and why' },
    ],
  },
  {
    name: 'skills',
    description: 'Manage WorkOS skills for coding agents (Claude Code, Codex, Cursor, Goose)',
    commands: [
      {
        name: 'install',
        description: 'Install bundled AuthKit skills to coding agents',
        options: [
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
        name: 'uninstall',
        description: 'Remove installed WorkOS skills from coding agents',
        options: [
          {
            name: 'skill',
            type: 'array',
            description: 'Remove specific skill(s) by name',
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
        name: 'list',
        description: 'List available and installed skills',
        options: [
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
    ],
  },
  {
    name: 'mcp',
    description: 'Manage the WorkOS MCP server in coding agents (Claude Code, Codex, Cursor)',
    commands: [
      {
        name: 'install',
        description: 'Configure the WorkOS MCP server in detected coding agents',
        options: [
          {
            name: 'agent',
            type: 'array',
            description: 'Target specific agent(s): claude-code, codex, cursor',
            required: false,
            alias: 'a',
            hidden: false,
          },
        ],
      },
      {
        name: 'remove',
        description: 'Remove the WorkOS MCP server from coding agents',
        options: [
          {
            name: 'agent',
            type: 'array',
            description: 'Target specific agent(s): claude-code, codex, cursor',
            required: false,
            alias: 'a',
            hidden: false,
          },
        ],
      },
      {
        name: 'status',
        description: 'Show which coding agents have the WorkOS MCP server configured',
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
      {
        name: 'fix',
        type: 'boolean',
        description: 'Auto-update stale WorkOS skills (writes to <agent>/skills/workos/ and workos-widgets/ only)',
        required: false,
        default: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'verify-login',
    description:
      'Verify the AuthKit login loop end-to-end against the active environment (creates and deletes a throwaway user)',
    options: [
      insecureStorageOpt,
      apiKeyOpt,
      {
        name: 'client-id',
        type: 'string',
        description: 'WorkOS client ID (overrides the active environment)',
        required: false,
        hidden: false,
      },
      {
        name: 'method',
        type: 'string',
        description: 'Authentication method to verify',
        required: false,
        default: 'password',
        choices: ['password'],
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
        description:
          'Remove an environment from local CLI config (does not delete or unclaim the environment in WorkOS)',
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
      {
        name: 'claim',
        description: 'Claim an unclaimed WorkOS environment — link it to your account (permanent — cannot be undone)',
        options: [
          {
            name: 'json',
            type: 'boolean',
            description: 'Output in JSON format',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'provision',
        description: 'Provision a new unclaimed WorkOS environment (credentials only, no code changes)',
        options: [
          {
            name: 'json',
            type: 'boolean',
            description: 'Output provisioned credentials (apiKey, clientId, claimToken) as JSON',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
    ],
  },
  {
    name: 'api',
    description: 'Make authenticated requests to the WorkOS API',
    positionals: [
      {
        name: 'endpoint',
        type: 'string',
        description: "API endpoint path (e.g. /users), or 'ls' to list endpoints",
        required: false,
      },
      { name: 'filter', type: 'string', description: 'Filter keyword (used with ls)', required: false },
    ],
    options: [
      insecureStorageOpt,
      {
        name: 'method',
        type: 'string',
        description: 'HTTP method (default: GET, or POST if body provided)',
        required: false,
        alias: 'X',
        hidden: false,
      },
      { name: 'data', type: 'string', description: 'JSON request body', required: false, alias: 'd', hidden: false },
      {
        name: 'file',
        type: 'string',
        description: 'Read request body from a file (or - for stdin)',
        required: false,
        hidden: false,
      },
      {
        name: 'include',
        type: 'boolean',
        description: 'Show response headers',
        required: false,
        default: false,
        alias: 'i',
        hidden: false,
      },
      apiKeyOpt,
      {
        name: 'dry-run',
        type: 'boolean',
        description: 'Show the request without executing it',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'yes',
        type: 'boolean',
        description: 'Skip confirmation for mutating requests',
        required: false,
        default: false,
        alias: 'y',
        hidden: false,
      },
    ],
    examples: [
      'workos api ls',
      'workos api ls users',
      'workos api /user_management/users',
      'workos api /organizations -d \'{"name":"Acme"}\'',
      'workos api /organizations/org_123 -X DELETE',
    ],
  },
  {
    name: 'organization',
    description: 'Manage WorkOS organizations (create, update, get, list, delete) in the active environment',
    options: [insecureStorageOpt],
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
        options: [environmentIdOpt],
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
        options: [environmentIdOpt],
      },
      {
        name: 'get',
        description: 'Get an organization by its ID',
        positionals: [{ name: 'orgId', type: 'string', description: 'Organization ID (org_*)', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'list',
        description: 'List organizations with optional filters and pagination',
        options: [
          {
            name: 'domain',
            type: 'string',
            description: 'Filter organizations by domain (name/domain search)',
            required: false,
            hidden: false,
          },
          ...paginationOpts,
          environmentIdOpt,
        ],
      },
      {
        name: 'delete',
        description: 'Delete an organization by its ID',
        positionals: [{ name: 'orgId', type: 'string', description: 'Organization ID (org_*)', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
    ],
  },
  {
    name: 'user',
    description: 'Manage AuthKit users (get, list, update, delete) in the active environment',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'get',
        description: 'Get a user by their ID',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'list',
        description: 'List users with optional filters and pagination',
        options: [
          {
            name: 'email',
            type: 'string',
            description: 'Filter users by email address (search)',
            required: false,
            hidden: false,
          },
          ...paginationOpts,
          environmentIdOpt,
        ],
      },
      {
        name: 'update',
        description: 'Update user properties (name, email, locale, external ID)',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
        options: [
          { name: 'first-name', type: 'string', description: 'First name', required: false, hidden: false },
          { name: 'last-name', type: 'string', description: 'Last name', required: false, hidden: false },
          { name: 'email', type: 'string', description: 'New email address', required: false, hidden: false },
          { name: 'locale', type: 'string', description: 'Locale (e.g. en-US)', required: false, hidden: false },
          {
            name: 'external-id',
            type: 'string',
            description: 'External ID for cross-system mapping',
            required: false,
            hidden: false,
          },
          environmentIdOpt,
        ],
      },
      {
        name: 'delete',
        description: 'Delete a user by their ID',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
    ],
  },
  // --- Resource Management Commands ---
  {
    name: 'role',
    description: 'Manage roles in the active environment (environment and organization-scoped)',
    options: [
      insecureStorageOpt,
      {
        name: 'org',
        type: 'string',
        description: 'Organization ID (for organization roles)',
        required: false,
        hidden: false,
      },
    ],
    commands: [
      { name: 'list', description: 'List roles', options: [environmentIdOpt] },
      {
        name: 'get',
        description: 'Get a role by slug',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'create',
        description: 'Create a role',
        options: [
          { name: 'slug', type: 'string', description: 'Role slug', required: true, hidden: false },
          { name: 'name', type: 'string', description: 'Role name', required: true, hidden: false },
          { name: 'description', type: 'string', description: 'Role description', required: false, hidden: false },
          requireFlagYesOpt,
          environmentIdOpt,
        ],
      },
      {
        name: 'update',
        description: 'Update a role',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
        options: [
          { name: 'name', type: 'string', description: 'New name', required: false, hidden: false },
          { name: 'description', type: 'string', description: 'New description', required: false, hidden: false },
          requireFlagYesOpt,
          environmentIdOpt,
        ],
      },
      {
        name: 'delete',
        description: 'Delete an org-scoped role (requires --org)',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
      {
        name: 'set-permissions',
        description: 'Set all permissions on a role (replaces existing)',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
        options: [
          {
            name: 'permissions',
            type: 'string',
            description: 'Comma-separated permission slugs',
            required: true,
            hidden: false,
          },
          requireFlagYesOpt,
          environmentIdOpt,
        ],
      },
      {
        name: 'add-permission',
        description: 'Add a permission to a role',
        positionals: [
          { name: 'slug', type: 'string', description: 'Role slug', required: true },
          { name: 'permissionSlug', type: 'string', description: 'Permission slug', required: true },
        ],
        options: [requireFlagYesOpt, environmentIdOpt],
      },
      {
        name: 'remove-permission',
        description: 'Remove a permission from an org role (requires --org)',
        positionals: [
          { name: 'slug', type: 'string', description: 'Role slug', required: true },
          { name: 'permissionSlug', type: 'string', description: 'Permission slug', required: true },
        ],
        options: [requireFlagYesOpt, environmentIdOpt],
      },
    ],
  },
  {
    name: 'permission',
    description: 'Manage permissions in the active environment',
    options: [insecureStorageOpt],
    commands: [
      { name: 'list', description: 'List permissions', options: [environmentIdOpt] },
      {
        name: 'get',
        description: 'Get a permission',
        positionals: [{ name: 'slug', type: 'string', description: 'Permission slug', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'create',
        description: 'Create a permission',
        options: [
          { name: 'slug', type: 'string', description: 'Permission slug', required: true, hidden: false },
          { name: 'name', type: 'string', description: 'Permission name', required: true, hidden: false },
          {
            name: 'description',
            type: 'string',
            description: 'Permission description',
            required: false,
            hidden: false,
          },
          requireFlagYesOpt,
          environmentIdOpt,
        ],
      },
      {
        name: 'update',
        description: 'Update a permission',
        positionals: [{ name: 'slug', type: 'string', description: 'Permission slug', required: true }],
        options: [
          { name: 'name', type: 'string', description: 'New name', required: false, hidden: false },
          { name: 'description', type: 'string', description: 'New description', required: false, hidden: false },
          requireFlagYesOpt,
          environmentIdOpt,
        ],
      },
      {
        name: 'delete',
        description: 'Delete a permission',
        positionals: [{ name: 'slug', type: 'string', description: 'Permission slug', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
    ],
  },
  {
    name: 'membership',
    description: 'Manage organization memberships in the active environment',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'list',
        description: 'List memberships by user or organization',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID (org_*)', required: false, hidden: false },
          { name: 'user', type: 'string', description: 'User ID (user_*)', required: false, hidden: false },
          {
            name: 'limit',
            type: 'number',
            description: 'Maximum number of results to return (--org only)',
            required: false,
            hidden: false,
          },
          {
            name: 'before',
            type: 'string',
            description: 'Pagination cursor for results before a specific item (--org only)',
            required: false,
            hidden: false,
          },
          {
            name: 'after',
            type: 'string',
            description: 'Pagination cursor for results after a specific item (--org only)',
            required: false,
            hidden: false,
          },
          {
            name: 'order',
            type: 'string',
            description: 'Sort order, asc or desc (--org only)',
            required: false,
            choices: ['asc', 'desc'],
            hidden: false,
          },
          environmentIdOpt,
        ],
      },
      {
        name: 'get',
        description: 'Get a membership by its ID',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'create',
        description: 'Add a user to an organization',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID (org_*)', required: true, hidden: false },
          { name: 'user', type: 'string', description: 'User ID (user_*)', required: true, hidden: false },
          {
            name: 'role',
            type: 'string',
            description: 'Role ID (role_*) to assign',
            required: false,
            hidden: false,
          },
          environmentIdOpt,
        ],
      },
      {
        name: 'update',
        description: "Change a membership's role",
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
        options: [
          {
            name: 'role',
            type: 'string',
            description: 'Role ID (role_*) to assign',
            required: false,
            hidden: false,
          },
          requireFlagYesOpt,
          environmentIdOpt,
        ],
      },
      {
        name: 'delete',
        description: 'Delete a membership (removes the user from the organization)',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
      {
        name: 'deactivate',
        description: 'Deactivate a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
        options: [requireFlagYesOpt, environmentIdOpt],
      },
      {
        name: 'reactivate',
        description: 'Reactivate a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
        options: [environmentIdOpt],
      },
    ],
  },
  {
    name: 'invitation',
    description: 'Manage user invitations in the active environment',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'list',
        description: 'List invitations',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID (org_*)', required: false, hidden: false },
          { name: 'email', type: 'string', description: 'Filter by email (search)', required: false, hidden: false },
          {
            name: 'limit',
            type: 'number',
            description: 'Maximum number of results to return',
            required: false,
            hidden: false,
          },
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
          environmentIdOpt,
        ],
      },
      {
        name: 'get',
        description: 'Get an invitation (searches the most recent invitations)',
        positionals: [{ name: 'id', type: 'string', description: 'Invitation ID', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'send',
        description: 'Send an invitation',
        options: [
          { name: 'email', type: 'string', description: 'Email address to invite', required: true, hidden: false },
          { name: 'org', type: 'string', description: 'Organization ID (org_*)', required: false, hidden: false },
          {
            name: 'role',
            type: 'string',
            description: 'Role ID (role_*) to assign on acceptance',
            required: false,
            hidden: false,
          },
          {
            name: 'expires-in-days',
            type: 'number',
            description: 'Expiration in days (default 7)',
            required: false,
            hidden: false,
          },
          environmentIdOpt,
        ],
      },
      {
        name: 'revoke',
        description: 'Revoke an invitation',
        positionals: [{ name: 'id', type: 'string', description: 'Invitation ID', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
      {
        name: 'resend',
        description: 'Resend an invitation',
        positionals: [{ name: 'id', type: 'string', description: 'Invitation ID', required: true }],
        options: [environmentIdOpt],
      },
    ],
  },
  {
    name: 'session',
    description: 'Manage user sessions in the active environment',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'list',
        description: 'List sessions for a user',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID (user_*)', required: true }],
        options: [
          {
            name: 'limit',
            type: 'number',
            description: 'Maximum number of results to return',
            required: false,
            hidden: false,
          },
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
          environmentIdOpt,
        ],
      },
      {
        name: 'revoke',
        description: 'Revoke a session',
        positionals: [{ name: 'sessionId', type: 'string', description: 'Session ID', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
    ],
  },
  {
    name: 'connection',
    description: 'Manage SSO connections (read/delete)',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List connections',
        options: [
          { name: 'org', type: 'string', description: 'Filter by organization ID', required: false, hidden: false },
          { name: 'type', type: 'string', description: 'Filter by connection type', required: false, hidden: false },
          ...paginationOpts,
        ],
      },
      {
        name: 'get',
        description: 'Get a connection',
        positionals: [{ name: 'id', type: 'string', description: 'Connection ID', required: true }],
      },
      {
        name: 'delete',
        description: 'Delete a connection',
        positionals: [{ name: 'id', type: 'string', description: 'Connection ID', required: true }],
        options: [
          {
            name: 'force',
            type: 'boolean',
            description: 'Skip confirmation prompt',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
    ],
  },
  {
    name: 'directory',
    description: 'Manage directory sync (read/delete, list users/groups)',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List directories',
        options: [
          { name: 'org', type: 'string', description: 'Filter by organization ID', required: false, hidden: false },
          ...paginationOpts,
        ],
      },
      {
        name: 'get',
        description: 'Get a directory',
        positionals: [{ name: 'id', type: 'string', description: 'Directory ID', required: true }],
      },
      {
        name: 'delete',
        description: 'Delete a directory',
        positionals: [{ name: 'id', type: 'string', description: 'Directory ID', required: true }],
        options: [
          {
            name: 'force',
            type: 'boolean',
            description: 'Skip confirmation prompt',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'list-users',
        description: 'List directory users',
        options: [
          { name: 'directory', type: 'string', description: 'Directory ID', required: false, hidden: false },
          { name: 'group', type: 'string', description: 'Group ID', required: false, hidden: false },
          ...paginationOpts,
        ],
      },
      {
        name: 'list-groups',
        description: 'List directory groups',
        options: [
          { name: 'directory', type: 'string', description: 'Directory ID', required: true, hidden: false },
          ...paginationOpts,
        ],
      },
    ],
  },
  {
    name: 'event',
    description: 'Query WorkOS events',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'list',
        description: 'List events in the active environment',
        options: [
          {
            name: 'events',
            type: 'string',
            description: 'Comma-separated event types (required)',
            required: true,
            hidden: false,
          },
          {
            name: 'range-start',
            type: 'string',
            description: 'Range start (ISO date)',
            required: false,
            hidden: false,
          },
          { name: 'range-end', type: 'string', description: 'Range end (ISO date)', required: false, hidden: false },
          {
            name: 'after',
            type: 'string',
            description: 'Pagination cursor for results after a specific item',
            required: false,
            hidden: false,
          },
          {
            name: 'limit',
            type: 'number',
            description: 'Maximum number of results to return',
            required: false,
            hidden: false,
          },
          environmentIdOpt,
        ],
      },
    ],
  },
  {
    name: 'audit-log',
    description: 'Manage audit logs',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'create-event',
        description: 'Create an audit log event',
        positionals: [{ name: 'orgId', type: 'string', description: 'Organization ID', required: true }],
        options: [
          { name: 'action', type: 'string', description: 'Action name', required: false, hidden: false },
          { name: 'actor-type', type: 'string', description: 'Actor type', required: false, hidden: false },
          { name: 'actor-id', type: 'string', description: 'Actor ID', required: false, hidden: false },
          { name: 'file', type: 'string', description: 'Path to event JSON file', required: false, hidden: false },
        ],
      },
      {
        name: 'export',
        description: 'Export audit logs',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
          { name: 'range-start', type: 'string', description: 'Range start (ISO date)', required: true, hidden: false },
          { name: 'range-end', type: 'string', description: 'Range end (ISO date)', required: true, hidden: false },
        ],
      },
      { name: 'list-actions', description: 'List available audit log actions' },
      {
        name: 'get-schema',
        description: 'Get schema for an audit log action',
        positionals: [{ name: 'action', type: 'string', description: 'Action name', required: true }],
      },
      {
        name: 'create-schema',
        description: 'Create an audit log schema',
        positionals: [{ name: 'action', type: 'string', description: 'Action name', required: true }],
        options: [
          { name: 'file', type: 'string', description: 'Path to schema JSON file', required: true, hidden: false },
        ],
      },
      {
        name: 'get-retention',
        description: 'Get audit log retention period',
        positionals: [{ name: 'orgId', type: 'string', description: 'Organization ID', required: true }],
      },
    ],
  },
  {
    name: 'feature-flag',
    description: 'Manage feature flags in the active environment',
    options: [insecureStorageOpt],
    commands: [
      { name: 'list', description: 'List feature flags', options: [...paginationOpts, environmentIdOpt] },
      {
        name: 'get',
        description: 'Get a feature flag',
        positionals: [{ name: 'slug', type: 'string', description: 'Feature flag slug', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'enable',
        description: 'Enable a feature flag',
        positionals: [{ name: 'slug', type: 'string', description: 'Feature flag slug', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'disable',
        description: 'Disable a feature flag',
        positionals: [{ name: 'slug', type: 'string', description: 'Feature flag slug', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'add-target',
        description: 'Add a target (user or organization) to a feature flag',
        positionals: [
          { name: 'slug', type: 'string', description: 'Feature flag slug', required: true },
          { name: 'targetId', type: 'string', description: 'Target ID (user_* or org_*)', required: true },
        ],
        options: [environmentIdOpt],
      },
      {
        name: 'remove-target',
        description: 'Remove a target (user or organization) from a feature flag',
        positionals: [
          { name: 'slug', type: 'string', description: 'Feature flag slug', required: true },
          { name: 'targetId', type: 'string', description: 'Target ID (user_* or org_*)', required: true },
        ],
        options: [environmentIdOpt],
      },
    ],
  },
  {
    name: 'webhook',
    description: 'Manage webhooks',
    options: [insecureStorageOpt],
    commands: [
      { name: 'list', description: 'List webhook endpoints', options: [environmentIdOpt] },
      {
        name: 'create',
        description: 'Create a webhook endpoint (the signing secret is only visible in the WorkOS Dashboard)',
        options: [
          { name: 'url', type: 'string', description: 'Webhook endpoint URL (HTTPS)', required: true, hidden: false },
          { name: 'events', type: 'string', description: 'Comma-separated event types', required: true, hidden: false },
          environmentIdOpt,
        ],
      },
      {
        name: 'delete',
        description: 'Delete a webhook endpoint',
        positionals: [{ name: 'id', type: 'string', description: 'Webhook endpoint ID', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
    ],
  },
  {
    name: 'config',
    description: 'Manage AuthKit app configuration (redirect URIs, CORS, homepage)',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'redirect',
        description: 'Manage redirect URIs',
        commands: [
          {
            name: 'add',
            description:
              'Add a redirect URI (merges over the current list; a concurrent edit elsewhere may be overwritten)',
            positionals: [{ name: 'uri', type: 'string', description: 'Redirect URI', required: true }],
            options: [environmentIdOpt],
          },
        ],
      },
      {
        name: 'cors',
        description: 'Manage CORS origins',
        commands: [
          {
            name: 'add',
            description:
              'Add a CORS origin (merges over the current list; a concurrent edit elsewhere may be overwritten)',
            positionals: [{ name: 'origin', type: 'string', description: 'CORS origin', required: true }],
            options: [environmentIdOpt],
          },
        ],
      },
      {
        name: 'homepage-url',
        description: 'Manage homepage URL',
        commands: [
          {
            name: 'set',
            description: "Set the app homepage URL on the environment's AuthKit application",
            positionals: [{ name: 'url', type: 'string', description: 'Homepage URL', required: true }],
            options: [environmentIdOpt],
          },
        ],
      },
    ],
  },
  {
    name: 'portal',
    description: 'Manage Admin Portal',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'generate-link',
        description:
          'Generate an Admin Portal setup link (expires prior links of the same intent; --return-url/--success-url and the audit_logs intent are not supported on this plane)',
        options: [
          {
            name: 'intent',
            type: 'string',
            description: 'Portal intent (sso, dsync, log_streams, domain_verification, certificate_renewal)',
            required: true,
            hidden: false,
          },
          { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
          environmentIdOpt,
        ],
      },
    ],
  },
  {
    name: 'vault',
    description: 'Manage WorkOS Vault secrets',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      { name: 'list', description: 'List vault objects', options: [...paginationOpts] },
      {
        name: 'get',
        description: 'Get a vault object (metadata only; use --decrypt to include value)',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
        options: [
          {
            name: 'decrypt',
            type: 'boolean',
            description: 'Include the decrypted secret value',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'get-by-name',
        description: 'Get a vault object by name (metadata only; use --decrypt to include value)',
        positionals: [{ name: 'name', type: 'string', description: 'Object name', required: true }],
        options: [
          {
            name: 'decrypt',
            type: 'boolean',
            description: 'Include the decrypted secret value',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'create',
        description: 'Create a vault object (reads value from stdin when --value is omitted or -)',
        options: [
          { name: 'name', type: 'string', description: 'Object name', required: true, hidden: false },
          {
            name: 'value',
            type: 'string',
            description: 'Secret value (omit or use - to read from stdin)',
            required: false,
            hidden: false,
          },
          { name: 'org', type: 'string', description: 'Organization ID (required)', required: true, hidden: false },
        ],
      },
      {
        name: 'update',
        description: 'Update a vault object (reads value from stdin when --value is omitted or -)',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
        options: [
          {
            name: 'value',
            type: 'string',
            description: 'New value (omit or use - to read from stdin)',
            required: false,
            hidden: false,
          },
          { name: 'version-check', type: 'string', description: 'Version check ID', required: false, hidden: false },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a vault object',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
      },
      {
        name: 'describe',
        description: 'Describe a vault object',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
      },
      {
        name: 'list-versions',
        description: 'List vault object versions',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
      },
      {
        name: 'run',
        description: 'Run a command with Vault secrets injected as environment variables',
        options: [
          {
            name: 'secret',
            type: 'array',
            description: 'Map a vault object to an env var: ENV_VAR=vault-name (repeatable)',
            required: true,
            hidden: false,
          },
          {
            name: 'env',
            type: 'string',
            description: 'Environment name to read API key from (defaults to active)',
            required: false,
            hidden: false,
          },
          {
            name: 'dry-run',
            type: 'boolean',
            description: 'Print which secrets would be injected, no fetch',
            required: false,
            default: false,
            hidden: false,
          },
        ],
      },
    ],
  },
  {
    name: 'api-key',
    description: 'Manage API keys',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List API keys',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
          ...paginationOpts,
        ],
      },
      {
        name: 'create',
        description: 'Create an API key',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
          { name: 'name', type: 'string', description: 'Key name', required: true, hidden: false },
          {
            name: 'permissions',
            type: 'string',
            description: 'Comma-separated permissions',
            required: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'validate',
        description: 'Validate an API key',
        positionals: [{ name: 'value', type: 'string', description: 'API key value', required: true }],
      },
      {
        name: 'delete',
        description: 'Delete an API key',
        positionals: [{ name: 'id', type: 'string', description: 'API key ID', required: true }],
      },
    ],
  },
  {
    name: 'org-domain',
    description: 'Manage organization domains',
    options: [insecureStorageOpt],
    commands: [
      {
        name: 'get',
        description: 'Get a domain',
        positionals: [{ name: 'id', type: 'string', description: 'Domain ID', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'create',
        description: 'Add a domain to an organization (added as verified)',
        positionals: [{ name: 'domain', type: 'string', description: 'Domain name', required: true }],
        options: [
          { name: 'org', type: 'string', description: 'Organization ID (org_*)', required: true, hidden: false },
          environmentIdOpt,
        ],
      },
      {
        name: 'verify',
        description: 'Restart verification for a domain (issues a fresh verification token)',
        positionals: [{ name: 'id', type: 'string', description: 'Domain ID', required: true }],
        options: [environmentIdOpt],
      },
      {
        name: 'delete',
        description: 'Delete a domain',
        positionals: [{ name: 'id', type: 'string', description: 'Domain ID', required: true }],
        options: [confirmYesOpt, environmentIdOpt],
      },
    ],
  },
  // --- Emulator (hidden: unreleased beta feature) ---
  // --- Workflow Commands ---
  {
    name: 'seed',
    description: 'Seed WorkOS environment from a YAML config file',
    options: [
      insecureStorageOpt,
      apiKeyOpt,
      { name: 'file', type: 'string', description: 'Path to seed YAML file', required: false, hidden: false },
      {
        name: 'clean',
        type: 'boolean',
        description: 'Tear down seeded resources',
        required: false,
        default: false,
        hidden: false,
      },
      {
        name: 'init',
        type: 'boolean',
        description: 'Create an example workos-seed.yml file',
        required: false,
        default: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'setup',
    description: 'Set up your coding agent (install WorkOS skills + MCP server)',
    options: [
      insecureStorageOpt,
      { name: 'agents', type: 'string', description: 'Comma-separated agent keys', required: false, hidden: false },
      { name: 'skills-only', type: 'boolean', description: 'Install skills only', required: false, hidden: false },
      { name: 'mcp-only', type: 'boolean', description: 'Install the MCP server only', required: false, hidden: false },
      { name: 'yes', type: 'boolean', description: 'Install without prompting', required: false, hidden: false },
      {
        name: 'reset',
        type: 'boolean',
        description: 'Re-enable automatic setup offers',
        required: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'setup-org',
    description: 'One-shot organization onboarding',
    positionals: [{ name: 'name', type: 'string', description: 'Organization name', required: true }],
    options: [
      insecureStorageOpt,
      apiKeyOpt,
      { name: 'domain', type: 'string', description: 'Domain to add', required: false, hidden: false },
      { name: 'roles', type: 'string', description: 'Comma-separated role slugs', required: false, hidden: false },
    ],
  },
  {
    name: 'onboard-user',
    description: 'Onboard a user (send invitation, assign role)',
    positionals: [{ name: 'email', type: 'string', description: 'User email', required: true }],
    options: [
      insecureStorageOpt,
      apiKeyOpt,
      { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
      { name: 'role', type: 'string', description: 'Role slug', required: false, hidden: false },
      {
        name: 'wait',
        type: 'boolean',
        description: 'Wait for invitation acceptance',
        required: false,
        default: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'debug-sso',
    description: 'Diagnose SSO connection issues',
    positionals: [{ name: 'connectionId', type: 'string', description: 'Connection ID', required: true }],
    options: [insecureStorageOpt, apiKeyOpt],
  },
  {
    name: 'debug-sync',
    description: 'Diagnose directory sync issues',
    positionals: [{ name: 'directoryId', type: 'string', description: 'Directory ID', required: true }],
    options: [insecureStorageOpt, apiKeyOpt],
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
      // Distinct from --force-install above: this one overrides the
      // "AuthKit is already installed" preflight guard, and the guard's own
      // error tells agents to pass it, so it has to be discoverable here.
      {
        name: 'force',
        type: 'boolean',
        description: 'Continue even if AuthKit is already installed in this project',
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
      {
        name: 'router',
        type: 'string',
        description: 'Next.js router to target when detection is ambiguous (app or pages)',
        required: false,
        hidden: false,
      },
    ],
  },
  {
    name: 'migrations',
    description: MIGRATIONS_DESCRIPTION,
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'export',
        description:
          'Export identity data from a source provider (or any provider via CSV, e.g. Supabase) into a WorkOS migration package',
      },
      { name: 'export-template', description: 'Export a blank CSV template with headers and example rows' },
      { name: 'import', description: 'Import users from CSV into WorkOS' },
      { name: 'import-package', description: 'Import a migration package directory' },
      {
        name: 'generate-package-template',
        description: 'Generate an empty migration package skeleton for manual or scripted population',
      },
      { name: 'validate', description: 'Validate a WorkOS migration CSV file' },
      { name: 'validate-package', description: 'Validate a migration package directory against the schema contract' },
      { name: 'export-auth0', description: 'Export users from Auth0' },
      { name: 'export-cognito', description: 'Export users from AWS Cognito' },
      { name: 'merge-passwords', description: 'Merge Auth0 password exports into CSV' },
      { name: 'transform-clerk', description: 'Transform Clerk CSV to WorkOS format' },
      { name: 'transform-firebase', description: 'Transform Firebase JSON to WorkOS format' },
      { name: 'analyze', description: 'Analyze import errors and generate retry plan' },
      { name: 'enroll-totp', description: 'Enroll TOTP MFA factors' },
      { name: 'process-roles', description: 'Create roles and assign permissions in WorkOS' },
      { name: 'wizard', description: 'Guided interactive migration wizard' },
    ],
  },
  {
    name: 'emulate',
    description: 'Start a local WorkOS API emulator',
    options: [
      {
        name: 'port',
        type: 'number',
        description: 'Port to listen on',
        required: false,
        default: 4100,
        alias: 'p',
        hidden: false,
      },
      {
        name: 'seed',
        type: 'string',
        description: 'Path to seed config file (YAML or JSON)',
        required: false,
        alias: 's',
        hidden: false,
      },
      {
        name: 'interactive',
        type: 'boolean',
        description: 'Show login pages for SSO/AuthKit',
        required: false,
        default: false,
        alias: 'i',
        hidden: false,
      },
    ],
    examples: [
      'workos emulate',
      'workos emulate --port 9100 --json',
      'workos emulate --seed workos-emulate.config.yaml',
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
  {
    name: 'mode',
    type: 'string',
    description: 'Interaction mode: human, coding agent, or CI automation',
    required: false,
    choices: ['human', 'agent', 'ci'],
    hidden: false,
  },
  { name: 'help', type: 'boolean', description: 'Show help', required: false, alias: 'h', hidden: false },
  { name: 'version', type: 'boolean', description: 'Show version number', required: false, alias: 'v', hidden: false },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const helpJsonCommandNames = new Set([
  ...commands.map((command) => command.name.split(' ')[0]),
  ...Object.keys(COMMAND_ALIASES),
]);

/**
 * Extract the requested command from raw argv before yargs parses --help.
 *
 * This intentionally matches only known command names so option values from
 * global flags like `--mode agent` are not mistaken for commands.
 */
export function extractHelpJsonCommand(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--mode') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--mode=')) {
      continue;
    }
    if (!arg.startsWith('-') && helpJsonCommandNames.has(arg)) {
      return COMMAND_ALIASES[arg] ?? arg;
    }
  }
  return undefined;
}

/**
 * Build a machine-readable command tree for --help --json output.
 *
 * @param subcommand - Optional command name to return a subtree for (e.g. "env").
 *                     Returns full tree if omitted or if command not found.
 */
/**
 * Top-level command names (first token of each registered command). Used by
 * telemetry to recognise real commands without trusting arbitrary argv tokens
 * (so option values / secrets are never recorded as a command name).
 */
export function getTopLevelCommandNames(): string[] {
  return commands.map((c) => c.name.split(' ')[0]);
}

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
