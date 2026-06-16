import { config, version } from '../cli.config.js';
import { getWorkOSApiUrl } from '../utils/urls.js';

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
 * Env var overrides config default.
 */
export function getCliAuthClientId(): string {
  return config.workos.clientId;
}

/**
 * Get the AuthKit domain.
 * Env var overrides config default.
 */
export function getAuthkitDomain(): string {
  return process.env.WORKOS_AUTHKIT_DOMAIN || config.workos.authkitDomain;
}

/**
 * Get the LLM gateway URL.
 * Derived from the WorkOS API host (override via WORKOS_API_URL).
 */
export function getLlmGatewayUrl(): string {
  return `${getWorkOSApiUrl().replace(/\/$/, '')}/llm-gateway`;
}

/**
 * Get the CLI telemetry URL.
 * Derived from the WorkOS API host (override via WORKOS_API_URL).
 */
export function getTelemetryUrl(): string {
  return `${getWorkOSApiUrl().replace(/\/$/, '')}/cli`;
}
