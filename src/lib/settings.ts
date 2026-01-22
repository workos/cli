import { createRequire } from 'module';
import { config } from '../../installer.config.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json');

/**
 * Get version from package.json
 */
export function getVersion(): string {
  return pkg.version;
}

export interface InstallerConfig {
  model: string;
  workos: {
    clientId: string;
    authkitDomain: string;
    llmGatewayUrl: string;
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
  return process.env.WORKOS_CLIENT_ID || config.workos.clientId;
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
 * Env var overrides config default.
 */
export function getLlmGatewayUrl(): string {
  return process.env.WORKOS_LLM_GATEWAY_URL || config.workos.llmGatewayUrl;
}
