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

export const DEBUG = false;

export const WORKOS_DOCS_URL = 'https://workos.com/docs/authkit';
export const WORKOS_DASHBOARD_URL = 'https://dashboard.workos.com';
export const ISSUES_URL = 'https://github.com/workos/authkit-wizard/issues';

// Telemetry (disabled for now - can be enabled later)
export const ANALYTICS_ENABLED = false;
export const WIZARD_INTERACTION_EVENT_NAME = 'wizard interaction';

// OAuth port (kept for legacy compatibility, not used by WorkOS wizard)
export const OAUTH_PORT = 8239;
