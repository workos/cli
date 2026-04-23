import type { InstallerConfig } from './lib/settings.js';
import pkg from '../package.json' with { type: 'json' };

export const version = pkg.version;

export const config = {
  model: 'claude-opus-4-5-20251101',
  doctorModel: 'claude-haiku-4-5-20251001',

  // Production defaults - override via env vars for local dev
  workos: {
    clientId: 'client_01KFKHSZWK9ADVJV854PDFQCCR',
    authkitDomain: 'https://signin.workos.com',
    llmGatewayUrl: 'https://api.workos.com/llm-gateway',
  },

  telemetry: {
    enabled: true,
    eventName: 'installer interaction',
  },

  proxy: {
    // Refresh token when it expires within this window (default: 1 minute)
    refreshThresholdMs: 60_000,
  },

  nodeVersion: '>=20.20',

  logging: {
    debugMode: false,
  },

  documentation: {
    workosDocsUrl: 'https://workos.com/docs/authkit',
    dashboardUrl: 'https://dashboard.workos.com',
    issuesUrl: 'https://github.com/workos/cli/issues',
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
    python: {
      port: 8000,
      callbackPath: '/auth/callback/',
    },
    ruby: {
      port: 3000,
      callbackPath: '/auth/callback',
    },
    php: {
      port: 8000,
      callbackPath: '/auth/callback',
    },
    phpLaravel: {
      port: 8000,
      callbackPath: '/auth/callback',
    },
    go: {
      port: 8080,
      callbackPath: '/auth/callback',
    },
    dotnet: {
      port: 5000,
      callbackPath: '/auth/callback',
    },
    elixir: {
      port: 4000,
      callbackPath: '/auth/callback',
    },
    kotlin: {
      port: 8080,
      callbackPath: '/auth/callback',
    },
  },

  legacy: {
    oauthPort: 8239,
  },

  branding: {
    showAsciiArt: true,
    useCompact: false,
    compactAsciiArt: `⚡ WorkOS AuthKit Installer`,
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
