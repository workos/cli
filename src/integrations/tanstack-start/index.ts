/* TanStack Start integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { getPackageVersion } from '../../utils/package-json.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'TanStack Start',
    integration: 'tanstack-start',
    docsUrl: 'https://workos.com/docs/user-management/authkit/tanstack-start',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/tanstack-start',
    skillName: 'workos-authkit-tanstack-start',
    language: 'javascript',
    stability: 'stable',
    priority: 90,
  },

  detection: {
    packageName: '@tanstack/react-start',
    packageDisplayName: 'TanStack Start',
    getVersion: (packageJson: any) => getPackageVersion('@tanstack/react-start', packageJson),
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
      'Analyzed your TanStack Start project structure',
      'Created and configured WorkOS AuthKit',
      'Integrated authentication into your application',
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
