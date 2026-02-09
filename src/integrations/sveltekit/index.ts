/* SvelteKit integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { getPackageVersion } from '../../utils/package-json.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'SvelteKit',
    integration: 'sveltekit',
    docsUrl: 'https://github.com/workos/authkit-sveltekit',
    skillName: 'workos-authkit-sveltekit',
    language: 'javascript',
    stability: 'experimental',
    priority: 85,
  },

  detection: {
    packageName: '@sveltejs/kit',
    packageDisplayName: 'SvelteKit',
    getVersion: (packageJson: any) => getPackageVersion('@sveltejs/kit', packageJson),
  },

  environment: {
    uploadToHosting: true,
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
      'Analyzed your SvelteKit project structure',
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
