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
  nodeVersion: string;
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
 * Get the CLI auth client ID.
 * Env var (WORKOS_CLIENT_ID) overrides the config default.
 */
export function getCliAuthClientId(): string {
  return process.env.WORKOS_CLIENT_ID || config.workos.clientId;
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
