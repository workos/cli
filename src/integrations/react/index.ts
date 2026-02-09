/* React SPA integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'React (SPA)',
    integration: 'react',
    docsUrl: 'https://workos.com/docs/user-management/authkit/react',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/react',
    skillName: 'workos-authkit-react',
    language: 'javascript',
    stability: 'stable',
    priority: 70,
  },

  detection: {
    packageName: 'react',
    packageDisplayName: 'React',
    getVersion: (packageJson: any) => packageJson.dependencies?.react || packageJson.devDependencies?.react,
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
      'Analyzed your React project structure',
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
