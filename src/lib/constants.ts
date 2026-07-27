import { getConfig } from './settings.js';

/**
 * Integration identifier type.
 * No longer an enum — each integration self-registers via the auto-discovery registry.
 * The string value matches the integration directory name (e.g., 'nextjs', 'react-router').
 */
export type Integration = string;

/**
 * Well-known integration names for backwards compatibility.
 * New integrations do NOT need to be added here — they're auto-discovered.
 */
export const KNOWN_INTEGRATIONS = {
  nextjs: 'nextjs',
  react: 'react',
  tanstackStart: 'tanstack-start',
  reactRouter: 'react-router',
  vanillaJs: 'vanilla-js',
} as const;

export interface Args {
  debug: boolean;
  integration: Integration;
}

export const IS_DEV = ['test', 'development'].includes(process.env.NODE_ENV ?? '');

const settings = getConfig();

export const DEBUG = settings.logging.debugMode;
export const WORKOS_DOCS_URL = settings.documentation.workosDocsUrl;
export const WORKOS_DASHBOARD_URL = settings.documentation.dashboardUrl;
export const ISSUES_URL = settings.documentation.issuesUrl;
export const ANALYTICS_ENABLED = settings.telemetry.enabled;
export const INSTALLER_INTERACTION_EVENT_NAME = settings.telemetry.eventName;
export const OAUTH_PORT = settings.legacy.oauthPort;

/**
 * WorkOS MCP server identity, shared by the `mcp` command group and the
 * per-client writers in `lib/mcp-clients.ts`.
 *
 * The server is secret-free: HTTP transport with OAuth handled by each client
 * on first connect, so configuring it never requires CLI auth.
 */
export const MCP_SERVER_NAME = 'workos';
export const MCP_SERVER_URL = 'https://mcp.workos.com/mcp';

/**
 * Shared description for the `migrations` command, referenced by both the yargs
 * registration (`bin.ts`) and the JSON help registry (`help-json.ts`) so the two
 * surfaces cannot drift. Advertises the generic-CSV path (e.g. Supabase) without
 * implying a dedicated exporter exists for it. Hand-maintained — not derived from
 * `@workos/migrations`.
 */
export const MIGRATIONS_DESCRIPTION =
  'Migrate users to WorkOS from Auth0, Cognito, Clerk, Firebase, or any provider via CSV (e.g. Supabase)';

/**
 * Common glob patterns to ignore when searching for files.
 * Used by multiple integrations.
 */
export const IGNORE_PATTERNS: string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/public/**',
  '**/.next/**',
];
