import { settings as settingsConfig } from '../../settings.config.js';

export interface Settings {
  version: string;
  model: string;
  cliAuth: {
    clientId: string;
  };
  gateway: {
    development: string;
    production: string;
    port: number;
  };
  api: {
    workos: {
      development: string;
      production: string;
    };
    dashboard: {
      development: string;
      production: string;
    };
  };
  telemetry: {
    enabled: boolean;
    eventName: string;
  };
  nodeVersion: string;
  logging: {
    logFile: string;
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
  };
}

/**
 * Get settings from config
 */
export function getSettings(): Settings {
  return settingsConfig;
}

/**
 * Get the CLI auth client ID.
 * Checks WORKOS_CLIENT_ID env var first (for dev/staging), falls back to settings.
 */
export function getCliAuthClientId(): string {
  return process.env.WORKOS_CLIENT_ID || settingsConfig.cliAuth.clientId;
}
