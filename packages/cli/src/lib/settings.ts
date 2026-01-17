import settingsJson from '../../settings.json' with { type: 'json' };

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
 * Get settings from imported JSON
 */
export function getSettings(): Settings {
  return settingsJson as Settings;
}
