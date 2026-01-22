import type { Settings } from './src/lib/settings.js';

export const settings = {
  version: '1.0.0',
  model: 'claude-opus-4-5-20251101',
  cliAuth: {
    // Production client ID - override via WORKOS_CLIENT_ID env var for dev/staging
    clientId: 'client_01KFET29VF2PJV9BHMYJR6753Q',
    // AuthKit domain for Connect OAuth endpoints - override via WORKOS_AUTHKIT_DOMAIN env var
    authkitDomain: 'https://classic-jungle-88-staging.authkit.app',
  },

  gateway: {
    development: 'https://api.workos.engineer/llm-gateway',
    production: 'https://llm-gateway.example.com',
    port: 8000,
  },

  api: {
    workos: {
      development: 'http://localhost:8000',
      production: 'https://api.workos.com',
    },
    dashboard: {
      development: 'http://localhost:3000',
      production: 'https://dashboard.workos.com',
    },
  },

  telemetry: {
    enabled: true,
    eventName: 'wizard interaction',
  },

  nodeVersion: '>=18.17.0',

  logging: {
    logFile: '/tmp/authkit-wizard.log',
    debugMode: false,
  },

  documentation: {
    workosDocsUrl: 'https://workos.com/docs/authkit',
    dashboardUrl: 'https://dashboard.workos.com',
    issuesUrl: 'https://github.com/workos/authkit-wizard/issues',
  },

  frameworks: {
    nextjs: {
      port: 3000,
      callbackPath: '/auth/callback',
    },
    react: {
      port: 5173,
      callbackPath: '/callback',
    },
    tanstackStart: {
      port: 3000,
      callbackPath: '/api/auth/callback',
    },
    reactRouter: {
      port: 5173,
      callbackPath: '/callback',
    },
    vanillaJs: {
      port: 5173,
      callbackPath: '/callback',
    },
  },

  legacy: {
    oauthPort: 8239,
  },

  branding: {
    showAsciiArt: true,
    asciiArt: `░██       ░██                     ░██         ░██████     ░██████
░██       ░██                     ░██        ░██   ░██   ░██   ░██
░██  ░██  ░██  ░███████  ░██░████ ░██    ░██░██     ░██ ░██
░██ ░████ ░██ ░██    ░██ ░███     ░██   ░██ ░██     ░██  ░████████
░██░██ ░██░██ ░██    ░██ ░██      ░███████  ░██     ░██         ░██
░████   ░████ ░██    ░██ ░██      ░██   ░██  ░██   ░██   ░██   ░██
░███     ░███  ░███████  ░██      ░██    ░██  ░██████     ░██████



   ░███                  ░██    ░██        ░██     ░██ ░██   ░██
  ░██░██                 ░██    ░██        ░██    ░██        ░██
 ░██  ░██  ░██    ░██ ░████████ ░████████  ░██   ░██   ░██░████████
░█████████ ░██    ░██    ░██    ░██    ░██ ░███████    ░██   ░██
░██    ░██ ░██    ░██    ░██    ░██    ░██ ░██   ░██   ░██   ░██
░██    ░██ ░██   ░███    ░██    ░██    ░██ ░██    ░██  ░██   ░██
░██    ░██  ░█████░██     ░████ ░██    ░██ ░██     ░██ ░██    ░████    `,
  },
} as const satisfies Settings;
