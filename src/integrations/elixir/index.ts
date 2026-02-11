/* Elixir/Phoenix integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { SPINNER_MESSAGE } from '../../lib/framework-config.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { getOrAskForWorkOSCredentials } from '../../utils/clack-utils.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { writeEnvLocal } from '../../lib/env-writer.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'Elixir (Phoenix)',
    integration: 'elixir',
    docsUrl: 'https://github.com/workos/workos-elixir',
    skillName: 'workos-elixir',
    language: 'elixir',
    stability: 'experimental',
    priority: 30,
    packageManager: 'mix',
    manifestFile: 'mix.exs',
  },

  detection: {
    // Required by FrameworkDetection interface — stubs for non-JS integration.
    // Actual detection uses language-detection.ts (mix.exs) + registry manifestFile check.
    packageName: 'workos',
    packageDisplayName: 'WorkOS Elixir',
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
      'Analyzed your Phoenix project structure',
      'Installed workos Hex package',
      'Configured WorkOS in config/runtime.exs',
      'Created auth controller and routes',
    ],
    getOutroNextSteps: () => [
      'Run `mix phx.server` to test authentication',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

/**
 * Custom run function for Elixir — bypasses runAgentInstaller() which assumes
 * package.json exists. Directly calls initializeAgent/runAgent instead.
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

  // Write env vars to .env.local for the agent to reference
  const callerHandledConfig = Boolean(options.apiKey || options.clientId);
  if (!callerHandledConfig) {
    const port = 4000; // Phoenix default
    const callbackPath = '/auth/callback';
    const redirectUri = options.redirectUri || `http://localhost:${port}${callbackPath}`;

    writeEnvLocal(options.installDir, {
      ...(apiKey ? { WORKOS_API_KEY: apiKey } : {}),
      WORKOS_CLIENT_ID: clientId,
      WORKOS_REDIRECT_URI: redirectUri,
    });
  }

  // Build Elixir-specific prompt
  const integrationPrompt = buildElixirPrompt();

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
    integrationPrompt,
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

  // Build summary
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

function buildElixirPrompt(): string {
  return `You are integrating WorkOS AuthKit into this Elixir/Phoenix application.

## Project Context

- Framework: Phoenix (Elixir)
- Package manager: mix (Hex)

## Environment

The following environment variables have been configured in .env.local:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID
- WORKOS_REDIRECT_URI

Note: For Elixir/Phoenix, these should be read via System.get_env() in config/runtime.exs rather than from .env.local directly.

## Your Task

Use the \`workos-elixir\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Validating the Phoenix project structure
3. Installing the workos Hex package
4. Configuring WorkOS in runtime.exs
5. Creating auth controller and routes
6. Verification with mix compile

Report your progress using [STATUS] prefixes.

Begin by invoking the workos-elixir skill.`;
}
