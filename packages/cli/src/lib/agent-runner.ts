import {
  getWelcomeMessage,
  SPINNER_MESSAGE,
  type FrameworkConfig,
} from './framework-config.js';
import type { WizardOptions } from '../utils/types.js';
import {
  abort,
  confirmContinueIfNoOrDirtyGitRepo,
  ensurePackageIsInstalled,
  getOrAskForWorkOSCredentials,
  getPackageDotJson,
  isUsingTypeScript,
  printWelcome,
} from '../utils/clack-utils.js';
import { analytics } from '../utils/analytics.js';
import { WIZARD_INTERACTION_EVENT_NAME } from './constants.js';
import clack from '../utils/clack.js';
import {
  initializeAgent,
  runAgent,
  AgentSignals,
  AgentErrorType,
} from './agent-interface.js';
import { getCloudUrlFromRegion } from '../utils/urls.js';
import chalk from 'chalk';
import { uploadEnvironmentVariablesStep } from '../steps/index.js';
import { autoConfigureWorkOSEnvironment } from './workos-management.js';
import { detectPort, getCallbackPath } from './port-detection.js';
import { writeEnvLocal } from './env-writer.js';

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
 * Uses skill-based approach where agent invokes framework-specific skill.
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

  const skillName = config.metadata.skillName;
  if (!skillName) {
    throw new Error(
      `Framework ${config.metadata.name} missing skillName in config`,
    );
  }

  return `You are integrating WorkOS AuthKit into this ${
    config.metadata.name
  } application.

## Project Context

- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}${additionalContext}

## Environment

The following environment variables have been configured in .env.local:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID
- WORKOS_REDIRECT_URI
- WORKOS_COOKIE_PASSWORD

## Your Task

Use the \`${skillName}\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Installing the SDK
3. Creating the callback route
4. Setting up middleware/auth handling
5. Adding authentication UI to the home page

Report your progress using [STATUS] prefixes.

Begin by invoking the ${skillName} skill.`;
}
