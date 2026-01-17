import { getSettings } from './settings.js';

export enum Integration {
  nextjs = 'nextjs',
  react = 'react',
  tanstackStart = 'tanstack-start',
  reactRouter = 'react-router',
  vanillaJs = 'vanilla-js',
}

export function getIntegrationDescription(type: string): string {
  switch (type) {
    case Integration.nextjs:
      return 'Next.js';
    case Integration.react:
      return 'React (SPA)';
    case Integration.tanstackStart:
      return 'TanStack Start';
    case Integration.reactRouter:
      return 'React Router';
    case Integration.vanillaJs:
      return 'Vanilla JavaScript';
    default:
      throw new Error(`Unknown integration ${type}`);
  }
}

type IntegrationChoice = {
  name: string;
  value: string;
};

export function getIntegrationChoices(): IntegrationChoice[] {
  return Object.keys(Integration).map((type: string) => ({
    name: getIntegrationDescription(type),
    value: type,
  }));
}

export interface Args {
  debug: boolean;
  integration: Integration;
}

export const IS_DEV = ['test', 'development'].includes(
  process.env.NODE_ENV ?? '',
);

export const DEBUG = getSettings().logging.debugMode;

const settings = getSettings();
export const WORKOS_DOCS_URL = settings.documentation.workosDocsUrl;
export const WORKOS_DASHBOARD_URL = settings.documentation.dashboardUrl;
export const ISSUES_URL = settings.documentation.issuesUrl;

// Telemetry (disabled for now - can be enabled later)
export const ANALYTICS_ENABLED = settings.telemetry.enabled;
export const WIZARD_INTERACTION_EVENT_NAME = settings.telemetry.eventName;

// OAuth port (kept for legacy compatibility, not used by WorkOS wizard)
export const OAUTH_PORT = settings.legacy.oauthPort;
