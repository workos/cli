/* TanStack Start wizard using Claude Agent SDK */
import type { WizardOptions } from '../utils/types.js';
import type { FrameworkConfig } from '../lib/framework-config.js';
import { enableDebugLogs } from '../utils/debug.js';
import { runAgentWizard } from '../lib/agent-runner.js';
import { Integration } from '../lib/constants.js';
import { getPackageVersion } from '../utils/package-json.js';

const TANSTACK_START_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'TanStack Start',
    integration: Integration.tanstackStart,
    docsUrl: 'https://workos.com/docs/user-management/authkit/tanstack-start',
    unsupportedVersionDocsUrl:
      'https://workos.com/docs/user-management/authkit/tanstack-start',
    skillName: 'workos-authkit-tanstack-start',
  },

  detection: {
    packageName: '@tanstack/react-start',
    packageDisplayName: 'TanStack Start',
    getVersion: (packageJson: any) =>
      getPackageVersion('@tanstack/react-start', packageJson),
  },

  environment: {
    uploadToHosting: false,
    requiresApiKey: true, // Server-side framework
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

export async function runTanstackStartWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  await runAgentWizard(TANSTACK_START_AGENT_CONFIG, options);
}
