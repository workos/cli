import type { InstallerConfig } from './src/lib/settings.js';

export const config = {
  model: 'claude-opus-4-5-20251101',

  // Production defaults - override via env vars for local dev
  workos: {
    clientId: 'client_01KFKHSZWK9ADVJV854PDFQCCR',
    authkitDomain: 'https://signin.workos.com',
    llmGatewayUrl: 'https://api.workos.com/llm-gateway',
  },

  telemetry: {
    enabled: true,
    eventName: 'wizard interaction',
  },

  nodeVersion: '>=20.20',

  logging: {
    debugMode: false,
  },

  documentation: {
    workosDocsUrl: 'https://workos.com/docs/authkit',
    dashboardUrl: 'https://dashboard.workos.com',
    issuesUrl: 'https://github.com/workos/installer/issues',
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
    useCompact: false,
    compactAsciiArt: `⚡ WorkOS AuthKit Wizard`,
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
} as const satisfies InstallerConfig;
