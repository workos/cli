import { config, version } from '../cli.config.js';

/**
 * Get version from package.json
 */
export function getVersion(): string {
  return version;
}

export interface InstallerConfig {
  model: string;
  doctorModel: string;
  workos: {
    clientId: string;
    authkitDomain: string;
  };
  telemetry: {
    enabled: boolean;
    eventName: string;
  };
  proxy: {
    refreshThresholdMs: number;
  };
  logging: {
    debugMode: boolean;
  };
  documentation: {
    workosDocsUrl: string;
    dashboardUrl: string;
    issuesUrl: string;
  };
  frameworks: {
    [key: string]: {
      port: number;
      callbackPath: string;
    };
  };
  legacy: {
    oauthPort: number;
  };
  branding: {
    showAsciiArt: boolean;
    asciiArt: string;
    compactAsciiArt: string;
    useCompact: boolean;
  };
}

/**
 * Get config
 */
export function getConfig(): InstallerConfig {
  return config;
}

/**
 * Get the CLI auth client ID (from config; not env-overridable).
 *
 * NOTE: WORKOS_CLIENT_ID is already claimed by the developer's own
 * application client ID (read by credential-discovery.ts). Overriding
 * the CLI's own OAuth client ID with it causes token refresh to use the
 * wrong client and clear credentials. Use a distinct env var if an
 * override is needed.
 */
export function getCliAuthClientId(): string {
  return config.workos.clientId;
}

/**
 * Get the AuthKit domain.
 * Env var overrides config default.
 *
 * Note: WorkOS service endpoints (API, dashboard, LLM gateway, telemetry)
 * live in utils/urls.ts. AuthKit's domain stays here because it's config-
 * backed rather than derived from the API host.
 */
export function getAuthkitDomain(): string {
  return process.env.WORKOS_AUTHKIT_DOMAIN || config.workos.authkitDomain;
}
