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

  // Gather framework-specific context (e.g., Next.js router, React Native platform)
  const frameworkContext = config.metadata.gatherContext
    ? await config.metadata.gatherContext(options)
    : {};

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  // Build integration prompt
  const integrationPrompt = buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
      apiKey,
      clientId,
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
      estimatedDurationMinutes: config.ui.estimatedDurationMinutes,
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
 */
function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
    apiKey: string;
    clientId: string;
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

  return `You are integrating WorkOS AuthKit into this ${config.metadata.name} application.

Project context:
- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}
- WorkOS API Key: ${context.apiKey}
- WorkOS Client ID: ${context.clientId}${additionalContext}

## Your Task

Follow the official WorkOS AuthKit documentation to integrate authentication into this application.

## Instructions

1. **Access Documentation** - Get the latest integration documentation:
   - Use the WorkOS MCP server tools to access WorkOS documentation
   - Use WebFetch to read the SDK README from GitHub for ${config.metadata.name}:
     * Next.js: https://github.com/workos/authkit-nextjs/blob/main/README.md
     * React: https://github.com/workos/authkit-react/blob/main/README.md
     * React Router: https://github.com/workos/authkit-react-router/blob/main/README.md
     * TanStack Start: https://github.com/workos/authkit-tanstack-start/blob/main/README.md
     * Vanilla JS: https://github.com/workos/authkit-js/blob/main/README.md
   - The README is the source of truth for current SDK usage and examples

2. **Install SDK** - Install the appropriate WorkOS AuthKit package using the detected package manager (check lockfiles).

3. **Configure Environment** - Create/update .env.local with:
   - WORKOS_API_KEY: ${context.apiKey}
   - WORKOS_CLIENT_ID: ${context.clientId}
   - WORKOS_REDIRECT_URI: http://localhost:3000/callback
   - WORKOS_COOKIE_PASSWORD: <generate-32-char-random-string>

4. **Follow Official Docs** - Implement exactly as documented:
   - Create callback route
   - Create sign-in/sign-out routes
   - Set up middleware for route protection
   - Use environment variables (never hardcode credentials)

5. **Add UI Components** - REQUIRED: Update the home page (app/page.tsx or pages/index.tsx) to demonstrate authentication:

   When logged OUT:
   - Show prominent "Sign In" button/link that navigates to /auth/sign-in
   - Add clear messaging like "Please sign in to continue"

   When logged IN:
   - Display welcome message with user's name (e.g., "Welcome, {firstName}!")
   - Show user details: email, user ID, first name, last name
   - Show prominent "Sign Out" button/link that navigates to /auth/sign-out
   - Make the UI clean and visible (not hidden or tiny text)

   Use getUser() to check authentication status and conditionally render UI.
   This is CRITICAL - users need to see authentication is working!

6. **Report Status** - Use '[STATUS]' prefix to show progress:
   - [STATUS] Accessing WorkOS documentation
   - [STATUS] Installing SDK
   - [STATUS] Creating routes
   - [STATUS] Setting up middleware
   - [STATUS] Adding UI components
   - [STATUS] Complete

**IMPORTANT:** Use the WorkOS MCP server to access current documentation. Don't use outdated examples or hardcoded instructions.
`;
}
