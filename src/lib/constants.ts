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
export const WORKOS_TELEMETRY_ENABLED = process.env.WORKOS_TELEMETRY !== 'false';
export const OAUTH_PORT = settings.legacy.oauthPort;

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
