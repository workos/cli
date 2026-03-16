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
      {
        name: 'claim',
        description: 'Claim an unclaimed WorkOS environment (link it to your account)',
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
  // --- Resource Management Commands ---
  {
    name: 'role',
    description: 'Manage WorkOS roles (environment and organization-scoped)',
    options: [
      insecureStorageOpt,
      apiKeyOpt,
      {
        name: 'org',
        type: 'string',
        description: 'Organization ID (for org-scoped roles)',
        required: false,
        hidden: false,
      },
    ],
    commands: [
      { name: 'list', description: 'List roles', options: [] },
      {
        name: 'get',
        description: 'Get a role by slug',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
      },
      {
        name: 'create',
        description: 'Create a role',
        options: [
          { name: 'slug', type: 'string', description: 'Role slug', required: true, hidden: false },
          { name: 'name', type: 'string', description: 'Role name', required: true, hidden: false },
          { name: 'description', type: 'string', description: 'Role description', required: false, hidden: false },
        ],
      },
      {
        name: 'update',
        description: 'Update a role',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
        options: [
          { name: 'name', type: 'string', description: 'New name', required: false, hidden: false },
          { name: 'description', type: 'string', description: 'New description', required: false, hidden: false },
        ],
      },
      {
        name: 'delete',
        description: 'Delete an org-scoped role (requires --org)',
        positionals: [{ name: 'slug', type: 'string', description: 'Role slug', required: true }],
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
        ],
      },
      {
        name: 'add-permission',
        description: 'Add a permission to a role',
        positionals: [
          { name: 'slug', type: 'string', description: 'Role slug', required: true },
          { name: 'permissionSlug', type: 'string', description: 'Permission slug', required: true },
        ],
      },
      {
        name: 'remove-permission',
        description: 'Remove a permission from an org role (requires --org)',
        positionals: [
          { name: 'slug', type: 'string', description: 'Role slug', required: true },
          { name: 'permissionSlug', type: 'string', description: 'Permission slug', required: true },
        ],
      },
    ],
  },
  {
    name: 'permission',
    description: 'Manage WorkOS permissions',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      { name: 'list', description: 'List permissions', options: [...paginationOpts] },
      {
        name: 'get',
        description: 'Get a permission',
        positionals: [{ name: 'slug', type: 'string', description: 'Permission slug', required: true }],
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
        ],
      },
      {
        name: 'update',
        description: 'Update a permission',
        positionals: [{ name: 'slug', type: 'string', description: 'Permission slug', required: true }],
        options: [
          { name: 'name', type: 'string', description: 'New name', required: false, hidden: false },
          { name: 'description', type: 'string', description: 'New description', required: false, hidden: false },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a permission',
        positionals: [{ name: 'slug', type: 'string', description: 'Permission slug', required: true }],
      },
    ],
  },
  {
    name: 'membership',
    description: 'Manage organization memberships',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List memberships',
        options: [
          { name: 'org', type: 'string', description: 'Filter by organization ID', required: false, hidden: false },
          { name: 'user', type: 'string', description: 'Filter by user ID', required: false, hidden: false },
          ...paginationOpts,
        ],
      },
      {
        name: 'get',
        description: 'Get a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
      },
      {
        name: 'create',
        description: 'Create a membership',
        options: [
          { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
          { name: 'user', type: 'string', description: 'User ID', required: true, hidden: false },
          { name: 'role', type: 'string', description: 'Role slug', required: false, hidden: false },
        ],
      },
      {
        name: 'update',
        description: 'Update a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
        options: [{ name: 'role', type: 'string', description: 'New role slug', required: false, hidden: false }],
      },
      {
        name: 'delete',
        description: 'Delete a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
      },
      {
        name: 'deactivate',
        description: 'Deactivate a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
      },
      {
        name: 'reactivate',
        description: 'Reactivate a membership',
        positionals: [{ name: 'id', type: 'string', description: 'Membership ID', required: true }],
      },
    ],
  },
  {
    name: 'invitation',
    description: 'Manage user invitations',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List invitations',
        options: [
          { name: 'org', type: 'string', description: 'Filter by organization ID', required: false, hidden: false },
          { name: 'email', type: 'string', description: 'Filter by email', required: false, hidden: false },
          ...paginationOpts,
        ],
      },
      {
        name: 'get',
        description: 'Get an invitation',
        positionals: [{ name: 'id', type: 'string', description: 'Invitation ID', required: true }],
      },
      {
        name: 'send',
        description: 'Send an invitation',
        options: [
          { name: 'email', type: 'string', description: 'Email address', required: true, hidden: false },
          { name: 'org', type: 'string', description: 'Organization ID', required: false, hidden: false },
          { name: 'role', type: 'string', description: 'Role slug', required: false, hidden: false },
          {
            name: 'expires-in-days',
            type: 'number',
            description: 'Expiration in days',
            required: false,
            hidden: false,
          },
        ],
      },
      {
        name: 'revoke',
        description: 'Revoke an invitation',
        positionals: [{ name: 'id', type: 'string', description: 'Invitation ID', required: true }],
      },
      {
        name: 'resend',
        description: 'Resend an invitation',
        positionals: [{ name: 'id', type: 'string', description: 'Invitation ID', required: true }],
      },
    ],
  },
  {
    name: 'session',
    description: 'Manage user sessions',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List sessions for a user',
        positionals: [{ name: 'userId', type: 'string', description: 'User ID', required: true }],
        options: [...paginationOpts],
      },
      {
        name: 'revoke',
        description: 'Revoke a session',
        positionals: [{ name: 'sessionId', type: 'string', description: 'Session ID', required: true }],
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
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'list',
        description: 'List events',
        options: [
          {
            name: 'events',
            type: 'string',
            description: 'Comma-separated event types (required)',
            required: true,
            hidden: false,
          },
          { name: 'org', type: 'string', description: 'Filter by organization ID', required: false, hidden: false },
          {
            name: 'range-start',
            type: 'string',
            description: 'Range start (ISO date)',
            required: false,
            hidden: false,
          },
          { name: 'range-end', type: 'string', description: 'Range end (ISO date)', required: false, hidden: false },
          ...paginationOpts,
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
    description: 'Manage feature flags',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      { name: 'list', description: 'List feature flags', options: [...paginationOpts] },
      {
        name: 'get',
        description: 'Get a feature flag',
        positionals: [{ name: 'slug', type: 'string', description: 'Feature flag slug', required: true }],
      },
      {
        name: 'enable',
        description: 'Enable a feature flag',
        positionals: [{ name: 'slug', type: 'string', description: 'Feature flag slug', required: true }],
      },
      {
        name: 'disable',
        description: 'Disable a feature flag',
        positionals: [{ name: 'slug', type: 'string', description: 'Feature flag slug', required: true }],
      },
      {
        name: 'add-target',
        description: 'Add a target to a feature flag',
        positionals: [
          { name: 'slug', type: 'string', description: 'Feature flag slug', required: true },
          { name: 'targetId', type: 'string', description: 'Target ID', required: true },
        ],
      },
      {
        name: 'remove-target',
        description: 'Remove a target from a feature flag',
        positionals: [
          { name: 'slug', type: 'string', description: 'Feature flag slug', required: true },
          { name: 'targetId', type: 'string', description: 'Target ID', required: true },
        ],
      },
    ],
  },
  {
    name: 'webhook',
    description: 'Manage webhooks',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      { name: 'list', description: 'List webhooks' },
      {
        name: 'create',
        description: 'Create a webhook',
        options: [
          { name: 'url', type: 'string', description: 'Webhook endpoint URL', required: true, hidden: false },
          { name: 'events', type: 'string', description: 'Comma-separated event types', required: true, hidden: false },
        ],
      },
      {
        name: 'delete',
        description: 'Delete a webhook',
        positionals: [{ name: 'id', type: 'string', description: 'Webhook ID', required: true }],
      },
    ],
  },
  {
    name: 'config',
    description: 'Manage WorkOS configuration (redirect URIs, CORS, homepage)',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'redirect',
        description: 'Manage redirect URIs',
        commands: [
          {
            name: 'add',
            description: 'Add a redirect URI',
            positionals: [{ name: 'uri', type: 'string', description: 'Redirect URI', required: true }],
          },
        ],
      },
      {
        name: 'cors',
        description: 'Manage CORS origins',
        commands: [
          {
            name: 'add',
            description: 'Add a CORS origin',
            positionals: [{ name: 'origin', type: 'string', description: 'CORS origin', required: true }],
          },
        ],
      },
      {
        name: 'homepage-url',
        description: 'Manage homepage URL',
        commands: [
          {
            name: 'set',
            description: 'Set the homepage URL',
            positionals: [{ name: 'url', type: 'string', description: 'Homepage URL', required: true }],
          },
        ],
      },
    ],
  },
  {
    name: 'portal',
    description: 'Manage Admin Portal',
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'generate-link',
        description: 'Generate an Admin Portal link',
        options: [
          {
            name: 'intent',
            type: 'string',
            description: 'Portal intent (sso, dsync, audit_logs, log_streams)',
            required: true,
            hidden: false,
          },
          { name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false },
          {
            name: 'return-url',
            type: 'string',
            description: 'Return URL after portal',
            required: false,
            hidden: false,
          },
          { name: 'success-url', type: 'string', description: 'Success URL', required: false, hidden: false },
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
        description: 'Get a vault object',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
      },
      {
        name: 'get-by-name',
        description: 'Get a vault object by name',
        positionals: [{ name: 'name', type: 'string', description: 'Object name', required: true }],
      },
      {
        name: 'create',
        description: 'Create a vault object',
        options: [
          { name: 'name', type: 'string', description: 'Object name', required: true, hidden: false },
          { name: 'value', type: 'string', description: 'Secret value', required: true, hidden: false },
          { name: 'org', type: 'string', description: 'Organization ID', required: false, hidden: false },
        ],
      },
      {
        name: 'update',
        description: 'Update a vault object',
        positionals: [{ name: 'id', type: 'string', description: 'Object ID', required: true }],
        options: [
          { name: 'value', type: 'string', description: 'New value', required: true, hidden: false },
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
    options: [insecureStorageOpt, apiKeyOpt],
    commands: [
      {
        name: 'get',
        description: 'Get a domain',
        positionals: [{ name: 'id', type: 'string', description: 'Domain ID', required: true }],
      },
      {
        name: 'create',
        description: 'Create a domain',
        positionals: [{ name: 'domain', type: 'string', description: 'Domain name', required: true }],
        options: [{ name: 'org', type: 'string', description: 'Organization ID', required: true, hidden: false }],
      },
      {
        name: 'verify',
        description: 'Verify a domain',
        positionals: [{ name: 'id', type: 'string', description: 'Domain ID', required: true }],
      },
      {
        name: 'delete',
        description: 'Delete a domain',
        positionals: [{ name: 'id', type: 'string', description: 'Domain ID', required: true }],
      },
    ],
  },
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
