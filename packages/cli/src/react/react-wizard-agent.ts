/* React SPA wizard using Claude Agent SDK */
import type { WizardOptions } from '../utils/types';
import type { FrameworkConfig } from '../lib/framework-config';
import { enableDebugLogs } from '../utils/debug';
import { runAgentWizard } from '../lib/agent-runner';
import { Integration } from '../lib/constants';

const REACT_AGENT_CONFIG: FrameworkConfig = {
  metadata: {
    name: 'React',
    integration: Integration.react,
    docsUrl: 'https://workos.com/docs/user-management/authkit/react',
    unsupportedVersionDocsUrl:
      'https://workos.com/docs/user-management/authkit/react',
  },

  detection: {
    packageName: 'react',
    packageDisplayName: 'React',
    getVersion: (packageJson: any) => packageJson.dependencies?.react || packageJson.devDependencies?.react,
  },

  environment: {
    uploadToHosting: false,
    requiresApiKey: false, // Client-only SPA
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
    estimatedDurationMinutes: 8,
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

export async function runReactWizardAgent(
  options: WizardOptions,
): Promise<void> {
  if (options.debug) {
    enableDebugLogs();
  }

  await runAgentWizard(REACT_AGENT_CONFIG, options);
}
