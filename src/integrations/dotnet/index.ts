/* .NET (ASP.NET Core) integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { SPINNER_MESSAGE } from '../../lib/framework-config.js';
import { getOrAskForWorkOSCredentials } from '../../utils/clack-utils.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { autoConfigureWorkOSEnvironment } from '../../lib/workos-management.js';
import { validateInstallation } from '../../lib/validation/index.js';

export const config: FrameworkConfig = {
  metadata: {
    name: '.NET (ASP.NET Core)',
    integration: 'dotnet',
    docsUrl: 'https://github.com/workos/workos-dotnet',
    skillName: 'workos-dotnet',
    language: 'dotnet',
    stability: 'experimental',
    priority: 35,
    packageManager: 'dotnet',
    manifestFile: '*.csproj',
  },

  detection: {
    // Detection handled by language-detection.ts globExists('*.csproj').
    // These fields satisfy the FrameworkDetection interface but aren't used for non-JS SDKs.
    packageName: 'WorkOS.net',
    packageDisplayName: '.NET (ASP.NET Core)',
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
      'Analyzed your ASP.NET Core project structure',
      'Installed WorkOS.net NuGet package',
      'Created authentication endpoints (login, callback, logout)',
      'Configured WorkOS in appsettings',
    ],
    getOutroNextSteps: () => [
      'Run `dotnet run` to start your development server',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

/**
 * Custom run function for .NET — bypasses runAgentInstaller's JS-centric assumptions
 * (no package.json, no .env.local, no TypeScript detection, no JS port detection).
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

  const { apiKey, clientId } = await getOrAskForWorkOSCredentials(options, config.environment.requiresApiKey);

  // Auto-configure WorkOS environment (redirect URI, CORS, homepage)
  const callerHandledConfig = Boolean(options.apiKey || options.clientId);
  if (!callerHandledConfig && apiKey) {
    const port = 5000; // ASP.NET Core default HTTP port
    await autoConfigureWorkOSEnvironment(apiKey, config.metadata.integration, port, {
      homepageUrl: options.homepageUrl,
      redirectUri: options.redirectUri,
    });
  }

  // Build prompt — credentials are passed via prompt context since .NET doesn't use .env.local
  const skillName = config.metadata.skillName!;
  const redirectUri = options.redirectUri || 'http://localhost:5000/auth/callback';

  const prompt = `You are integrating WorkOS AuthKit into this ASP.NET Core application.

## Project Context

- Framework: ASP.NET Core
- Language: C#
- Package manager: dotnet (NuGet)

## Environment

The following WorkOS credentials should be configured in appsettings.Development.json:
- WORKOS_API_KEY: ${apiKey || '(not provided)'}
- WORKOS_CLIENT_ID: ${clientId}
- WORKOS_REDIRECT_URI: ${redirectUri}

## Your Task

Use the \`${skillName}\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Installing the WorkOS.net NuGet package
3. Configuring DI registration
4. Creating authentication endpoints
5. Setting up appsettings configuration

Report your progress using [STATUS] prefixes.

Begin by invoking the ${skillName} skill.`;

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

  // Post-installation validation
  if (!options.noValidate) {
    options.emitter?.emit('validation:start', { framework: config.metadata.integration });

    const validationResult = await validateInstallation(config.metadata.integration, options.installDir, {
      runBuild: true,
    });

    if (validationResult.issues.length > 0) {
      options.emitter?.emit('validation:issues', { issues: validationResult.issues });
    }

    options.emitter?.emit('validation:complete', {
      passed: validationResult.passed,
      issueCount: validationResult.issues.length,
      durationMs: validationResult.durationMs,
    });
  }

  const envVars = config.environment.getEnvVars(apiKey, clientId);

  const changes = [
    ...config.ui.getOutroChanges({}),
    Object.keys(envVars).length > 0 ? 'Configured WorkOS credentials in appsettings' : '',
  ].filter(Boolean);

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
