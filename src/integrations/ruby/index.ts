/* Ruby/Rails integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { SPINNER_MESSAGE } from '../../lib/framework-config.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { getOrAskForWorkOSCredentials } from '../../utils/clack-utils.js';
import { autoConfigureWorkOSEnvironment } from '../../lib/workos-management.js';

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
  const { apiKey, clientId } = await getOrAskForWorkOSCredentials(options, config.environment.requiresApiKey);

  // Auto-configure WorkOS environment (redirect URI, CORS, homepage) if not already done
  const callerHandledConfig = Boolean(options.apiKey || options.clientId);
  if (!callerHandledConfig && apiKey) {
    const port = 3000; // Rails default
    await autoConfigureWorkOSEnvironment(apiKey, config.metadata.integration, port, {
      homepageUrl: options.homepageUrl,
      redirectUri: options.redirectUri,
    });
  }

  // Build prompt for the agent
  const redirectUri = options.redirectUri || 'http://localhost:3000/auth/callback';
  const prompt = `You are integrating WorkOS AuthKit into this Ruby on Rails application.

## Project Context

- Framework: Ruby (Rails)
- Language: Ruby

## Environment

The following environment variables should be configured in a .env file:
- WORKOS_API_KEY=${apiKey ? '(provided)' : '(not set)'}
- WORKOS_CLIENT_ID=${clientId || '(not set)'}
- WORKOS_REDIRECT_URI=${redirectUri}

## Your Task

Use the \`workos-ruby\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Installing the WorkOS Ruby gem
3. Creating the WorkOS initializer
4. Creating the AuthController with login, callback, and logout
5. Adding authentication routes

Report your progress using [STATUS] prefixes.

Begin by invoking the workos-ruby skill.`;

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
    throw new Error(`Agent SDK error: ${message}`);
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
