/* Vanilla JavaScript integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'Vanilla JavaScript',
    integration: 'vanilla-js',
    docsUrl: 'https://workos.com/docs/user-management/authkit/javascript',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/javascript',
    skillName: 'workos-authkit-vanilla-js',
    language: 'javascript',
    stability: 'stable',
    priority: 10, // Lowest — fallback for any JS project
  },

  detection: {
    packageName: 'workos',
    packageDisplayName: 'Vanilla JavaScript',
    getVersion: () => undefined,
  },

  environment: {
    uploadToHosting: false,
    requiresApiKey: false,
    getEnvVars: (_apiKey: string, clientId: string) => ({
      WORKOS_CLIENT_ID: clientId,
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

export async function run(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  const { runAgentInstaller } = await import('../../lib/agent-runner.js');
  return runAgentInstaller(config, options);
}
