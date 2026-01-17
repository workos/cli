import {
  getWelcomeMessage,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config';
import type { WizardOptions } from '../utils/types';
import {
  abort,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForWorkOSCredentials,
  getPackageDotJson,
  isUsingTypeScript,
  printWelcome,
} from '../utils/clack-utils';
import { analytics } from '../utils/analytics';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants';
import clack from '../utils/clack';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
} from './agent-interface';
import { getCloudUrlFromRegion } from '../utils/urls';
import chalk from 'chalk';
import { uploadEnvironmentVariablesStep } from '../steps';
import { autoConfigureWorkOSEnvironment } from './workos-management';
import { detectPort, getCallbackPath } from './port-detection';
import { writeEnvLocal } from './env-writer';

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using WorkOS MCP integration.
 */
export async function runAgentWizard(
  config: FrameworkConfig,
  options: WizardOptions,
): Promise<void> {
  // Setup phase
  printWelcome({ wizardName: getWelcomeMessage(config.metadata.name) });

  clack.log.info(
    `🧙 The wizard will use AI to intelligently set up WorkOS AuthKit in your ${config.metadata.name} project.`,
  );

  const typeScriptDetected = isUsingTypeScript(options);

  await confirmContinueIfNoOrDirtyGitRepo(options);

  // Framework detection and version
  const packageJson = await getPackageDotJson(options);
  await ensurePackageIsInstalled(
    packageJson,
    config.detection.packageName,
    config.detection.packageDisplayName,
  );

  const frameworkVersion = config.detection.getVersion(packageJson);

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  analytics.capture(WIZARD_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  // Get WorkOS credentials (API key optional for client-only SDKs)
  const { apiKey, clientId } = await getOrAskForWorkOSCredentials(
    options,
    config.environment.requiresApiKey,
  );

  // Auto-configure WorkOS environment (redirect URI, CORS, homepage)
  if (apiKey && config.environment.requiresApiKey) {
    const port = detectPort(config.metadata.integration, options.installDir);
    await autoConfigureWorkOSEnvironment(
      apiKey,
      config.metadata.integration,
      port,
      {
        homepageUrl: options.homepageUrl,
        redirectUri: options.redirectUri,
      },
    );
  }

  // Gather framework-specific context (e.g., Next.js router, React Native platform)
  const frameworkContext = config.metadata.gatherContext
    ? await config.metadata.gatherContext(options)
    : {};

  // Write environment variables to .env.local BEFORE agent runs
  // This prevents credentials from appearing in agent prompts
  const port = detectPort(config.metadata.integration, options.installDir);
  const callbackPath = getCallbackPath(config.metadata.integration);
  const redirectUri =
    options.redirectUri || `http://localhost:${port}${callbackPath}`;
  writeEnvLocal(options.installDir, {
    ...(apiKey ? { WORKOS_API_KEY: apiKey } : {}),
    WORKOS_CLIENT_ID: clientId,
    WORKOS_REDIRECT_URI: redirectUri,
  });

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  // Build integration prompt (credentials are already in .env.local)
  const integrationPrompt = buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
    },
    frameworkContext,
  );

  // Initialize and run agent
  const spinner = clack.spinner();

  const agent = initializeAgent(
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
    spinner,
    {
      spinnerMessage: SPINNER_MESSAGE,
      successMessage: config.ui.successMessage,
      errorMessage: 'Integration failed',
    },
  );

  // No error detection needed - we use skill-based approach
  // If agent fails, it will error naturally

  // Build environment variables from WorkOS credentials
  const envVars = config.environment.getEnvVars(apiKey, clientId);

  // Upload environment variables to hosting providers (if configured)
  let uploadedEnvVars: string[] = [];
  if (config.environment.uploadToHosting) {
    uploadedEnvVars = await uploadEnvironmentVariablesStep(envVars, {
      integration: config.metadata.integration,
      options,
    });
  }

  // Skip MCP server setup for now (WorkOS doesn't need it initially)
  // await addMCPServerToClientsStep({ ... });

  // Build outro message
  const continueUrl = undefined; // No signup flow for WorkOS wizard

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0
      ? `Added environment variables to .env file`
      : '',
    uploadedEnvVars.length > 0
      ? `Uploaded environment variables to your hosting provider`
      : '',
  ].filter(Boolean);

  const nextSteps = [
    ...config.ui.getOutroNextSteps(frameworkContext),
    uploadedEnvVars.length === 0 && config.environment.uploadToHosting
      ? `Upload your WorkOS credentials to your hosting provider`
      : '',
  ].filter(Boolean);

  const outroMessage = `
${chalk.green('Successfully installed WorkOS AuthKit!')}

${chalk.cyan('What the agent did:')}
${changes.map((change) => `• ${change}`).join('\n')}

${chalk.yellow('Next steps:')}
${nextSteps.map((step) => `• ${step}`).join('\n')}

Learn more: ${chalk.cyan(config.metadata.docsUrl)}
${continueUrl ? `\nContinue onboarding: ${chalk.cyan(continueUrl)}\n` : ``}
${chalk.dim(
  'Note: This wizard uses an LLM agent to analyze and modify your project. Please review the changes made.',
)}`;

  clack.outro(outroMessage);

  await analytics.shutdown('success');
}

/**
 * Build the integration prompt for the agent.
 * Uses shared base prompt with optional framework-specific addendum.
 * Note: Credentials are pre-written to .env.local, so not included in prompt.
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
  },
  frameworkContext: Record<string, any>,
): string {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0
      ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n')
      : '';

  const callbackPath = getCallbackPath(config.metadata.integration);

  return `You are integrating WorkOS AuthKit into this ${
    config.metadata.name
  } application.

Project context:
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- Environment: Credentials are pre-configured in .env.local${additionalContext}

## Your Task

Follow the official WorkOS AuthKit documentation to integrate authentication into this application.

## Instructions

1. **Access Documentation FIRST** - This is critical:
   - Use WebFetch to read the SDK README from GitHub (use raw URLs):
     * Next.js: https://raw.githubusercontent.com/workos/authkit-nextjs/main/README.md
     * React: https://raw.githubusercontent.com/workos/authkit-react/main/README.md
     * React Router: https://raw.githubusercontent.com/workos/authkit-react-router/main/README.md
     * TanStack Start: https://raw.githubusercontent.com/workos/authkit-tanstack-start/main/README.md
     * Vanilla JS: https://raw.githubusercontent.com/workos/authkit-js/main/README.md
   - The README is the **source of truth** - follow it exactly
   - Pay attention to framework version-specific instructions (e.g., Next.js 16+ uses proxy.ts)
   - Verify import paths by checking the package.json exports field if imports fail

2. **Install SDK** - Install the appropriate WorkOS AuthKit package using the detected package manager (check lockfiles).

3. **Verify Environment** - Check that .env.local exists with required variables:
   - WORKOS_API_KEY, WORKOS_CLIENT_ID, WORKOS_REDIRECT_URI, WORKOS_COOKIE_PASSWORD
   - These are already configured - DO NOT modify or log their values

4. **Create Callback Route** - CRITICAL: Create at EXACTLY this path: \`${callbackPath}\`
   - The WorkOS dashboard and .env.local are configured with this EXACT path
   - For Next.js: Create the file at \`app${callbackPath}/route.ts\` (e.g., \`app/api/auth/callback/route.ts\`)
   - IGNORE any different paths shown in examples - use THIS path: \`${callbackPath}\`
   - Use the SDK's handleAuth() function as shown in the README
   - For client-side SDKs (React/Vanilla), the SDK handles callbacks internally - no route needed

5. **Follow SDK Documentation EXACTLY** - Copy code from the README:
   - Set up middleware/proxy EXACTLY as shown in SDK docs (Next.js 16+ uses proxy.ts, not middleware.ts)
   - Use the authentication patterns from the README (e.g., getSignInUrl(), signOut())
   - Do NOT create custom sign-in/sign-out routes - the SDK handles this
   - Do NOT write custom cookie/session handling - the SDK does this internally
   - When in doubt, copy the exact code from the README

6. **Add UI Components** - Update the home page to demonstrate authentication:

   When logged OUT:
   - Show a "Sign In" button that triggers authentication (use SDK's recommended pattern)
   - The SDK README shows how to get the sign-in URL and trigger auth

   When logged IN:
   - Display welcome message with user's name
   - Show user details: email, name
   - Show "Sign Out" button (use SDK's signOut function)

   Use the SDK's user/session functions to check authentication status.

7. **Report Status** - Use '[STATUS]' prefix to show progress:
   - [STATUS] Accessing WorkOS documentation
   - [STATUS] Installing SDK
   - [STATUS] Creating routes
   - [STATUS] Setting up middleware
   - [STATUS] Adding UI components
   - [STATUS] Complete

**CRITICAL RULES:**
1. The callback route path \`${callbackPath}\` is NON-NEGOTIABLE - create a route at this exact path regardless of what docs suggest
2. For the route implementation, use the SDK's callback handler from the README - never write custom auth/cookie/session code
3. Credentials are in .env.local - never log, echo, or display their values
`;
}
