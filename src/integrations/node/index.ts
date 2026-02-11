/* Node.js (Express) integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { getPackageVersion } from '../../utils/package-json.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'Node.js (Express)',
    integration: 'node',
    docsUrl: 'https://workos.com/docs/authkit/vanilla/nodejs',
    skillName: 'workos-node',
    language: 'javascript',
    stability: 'experimental',
    priority: 70,
  },

  detection: {
    packageName: 'express',
    packageDisplayName: 'Express',
    getVersion: (packageJson: any) => getPackageVersion('express', packageJson),
  },

  environment: {
    uploadToHosting: false,
    requiresApiKey: true,
    getEnvVars: (apiKey: string, clientId: string) => ({
      WORKOS_API_KEY: apiKey,
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
      'Analyzed your Express project structure',
      'Installed and configured @workos-inc/node SDK',
      'Created authentication routes (/auth/login, /auth/callback, /auth/logout)',
      'Configured session management',
    ],
    getOutroNextSteps: () => [
      'Start your development server to test authentication',
      'Visit the WorkOS Dashboard to manage users and settings',
      'For production, replace in-memory sessions with Redis or a database store',
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
