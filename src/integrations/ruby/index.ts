/* Ruby/Rails integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { SPINNER_MESSAGE } from '../../lib/framework-config.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { getOrAskForWorkOSCredentials } from '../../utils/ui-utils.js';
import { autoConfigureWorkOSEnvironment } from '../../lib/workos-management.js';
import { getReference } from '../../lib/skills-assets.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'Ruby (Rails)',
    integration: 'ruby',
    docsUrl: 'https://workos.com/docs/authkit/vanilla/ruby',
    skillName: 'workos-ruby',
    language: 'ruby',
    stability: 'experimental',
    priority: 55,
    packageManager: 'bundle',
    manifestFile: 'Gemfile',
  },

  detection: {
    packageName: 'rails',
    packageDisplayName: 'Rails',
    getVersion: () => undefined,
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
      'Analyzed your Rails project structure',
      'Installed and configured the WorkOS Ruby SDK',
      'Created authentication controller with login, callback, and logout',
      'Added authentication routes to config/routes.rb',
    ],
    getOutroNextSteps: () => [
      'Start your Rails server with `rails server` to test authentication',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

/**
 * Custom run function for Ruby/Rails — bypasses runAgentInstaller
 * since that assumes a JS project (package.json, node_modules, .env.local).
 */
export async function run(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  options.emitter?.emit('status', {
    message: `Setting up WorkOS AuthKit for ${config.metadata.name}`,
  });

  analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  // Get WorkOS credentials
  // apiKey/clientId are mutable: dashboard-config 401 recovery may swap in a
  // fresh credential pair from a different environment.
  const { apiKey: initialApiKey, clientId: initialClientId } = await getOrAskForWorkOSCredentials(
    options,
    config.environment.requiresApiKey,
  );
  let apiKey = initialApiKey;
  let clientId = initialClientId;

  // Auto-configure WorkOS environment (redirect URI, CORS, homepage) if not already done
  const callerHandledConfig = Boolean(options.apiKey || options.clientId);
  if (!callerHandledConfig && apiKey) {
    const port = 3000; // Rails default
    const outcome = await autoConfigureWorkOSEnvironment(apiKey, config.metadata.integration, port, {
      homepageUrl: options.homepageUrl,
      redirectUri: options.redirectUri,
    });
    if (outcome) {
      apiKey = outcome.apiKey;
      if (outcome.clientId) clientId = outcome.clientId;
    }
  }

  // Build prompt for the agent
  const redirectUri = options.redirectUri || 'http://localhost:3000/auth/callback';
  const refContent = await getReference('workos-ruby');
  const prompt = `You are integrating WorkOS AuthKit into this Ruby on Rails application.

## Project Context

- Framework: Ruby (Rails)
- Language: Ruby

## Environment

The following environment variables are needed (create a .env file if one does not exist):
- WORKOS_API_KEY
- WORKOS_CLIENT_ID=${clientId}
- WORKOS_REDIRECT_URI=${redirectUri}

## Integration Instructions

${refContent}

Report your progress using [STATUS] prefixes.

Begin integration now.`;

  // Initialize and run agent
  const agent = await initializeAgent(
    {
      workingDirectory: options.installDir,
      workOSApiKey: apiKey,
      workOSApiHost: 'https://api.workos.com',
    },
    options,
  );

  const agentResult = await runAgent(
    agent,
    prompt,
    options,
    {
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
    },
    options.emitter,
  );

  if (agentResult.error) {
    await analytics.shutdown('error');
    const message = agentResult.errorMessage || agentResult.error;
    throw new Error(message);
  }

  // Build completion summary
  const changes = config.ui.getOutroChanges({});
  const nextSteps = config.ui.getOutroNextSteps({});

  const lines: string[] = [
    'Successfully installed WorkOS AuthKit!',
    '',
    'What the agent did:',
    ...changes.map((c) => `• ${c}`),
    '',
    'Next steps:',
    ...nextSteps.map((s) => `• ${s}`),
    '',
    `Learn more: ${config.metadata.docsUrl}`,
    '',
    'Note: This installer uses an LLM agent to analyze and modify your project. Please review the changes made.',
  ];

  await analytics.shutdown('success');

  return lines.join('\n');
}
