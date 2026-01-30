/* Vanilla JS wizard using Claude Agent SDK */
import type { InstallerOptions } from '../utils/types.js';
import type { FrameworkConfig } from '../lib/framework-config.js';
import { enableDebugLogs } from '../utils/debug.js';
import { runAgentInstaller } from '../lib/agent-runner.js';
import { Integration } from '../lib/constants.js';

const VANILLA_JS_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'Vanilla JavaScript',
    integration: Integration.vanillaJs,
    docsUrl: 'https://workos.com/docs/user-management/authkit/javascript',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/javascript',
    skillName: 'workos-authkit-vanilla-js',
  },

  detection: {
    packageName: 'workos',
    packageDisplayName: 'Vanilla JavaScript',
    getVersion: () => undefined,
  },

  environment: {
    uploadToHosting: false,
    requiresApiKey: false, // Client-only
    getEnvVars: (apiKey: string, clientId: string) => ({
      WORKOS_CLIENT_ID: clientId, // Only client ID needed
    }),
  },

  analytics: {
    getTags: () => ({}),
  },

  prompts: {},

  ui: {
    successMessage: 'WorkOS AuthKit integration complete',
    getOutroChanges: () => [
      'Created WorkOS AuthKit integration',
      'Added authentication to your JavaScript application',
      'Set up login/logout functionality',
    ],
    getOutroNextSteps: () => [
      'Start your development server to test authentication',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

export async function runVanillaJsInstallerAgent(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  return runAgentInstaller(VANILLA_JS_AGENT_CONFIG, options);
}
