import { getReference } from '@workos/skills';
import { SPINNER_MESSAGE, type FrameworkConfig } from './framework-config.js';
import { validateInstallation, quickCheckValidateAndFormat } from './validation/index.js';
import {
  runInstallSecurityChecks,
  securityFindingsToIssues,
  formatSecurityFindingsForAgent,
  formatBlockingSecurityError,
} from './validation/security-checks.js';
import type { InstallerOptions } from '../utils/types.js';
import {
  ensurePackageIsInstalled,
  getOrAskForWorkOSCredentials,
  getPackageDotJson,
  isUsingTypeScript,
} from '../utils/clack-utils.js';
import { analytics } from '../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from './constants.js';
import { initializeAgent, runAgent, type RetryConfig } from './agent-interface.js';
import { uploadEnvironmentVariablesStep } from '../steps/index.js';
import { autoConfigureWorkOSEnvironment } from './workos-management.js';
import { detectPort, getCallbackPath } from './port-detection.js';
import { writeEnvLocal } from './env-writer.js';

/**
 * Universal agent-powered wizard runner.
 * Handles the complete flow for any framework using WorkOS MCP integration.
 *
 * @returns A detailed summary of what was done and next steps
 */
export async function runAgentInstaller(config: FrameworkConfig, options: InstallerOptions): Promise<string> {
  // Emit status for UI adapters to render
  options.emitter?.emit('status', {
    message: `Setting up WorkOS AuthKit for ${config.metadata.name}`,
  });

  const typeScriptDetected = isUsingTypeScript(options);

  // Git check is now handled by the state machine - no need to check here

  // Framework detection and version
  const packageJson = await getPackageDotJson(options);
  await ensurePackageIsInstalled(packageJson, config.detection.packageName, config.detection.packageDisplayName);

  const frameworkVersion = config.detection.getVersion(packageJson);

  // Set analytics tags for framework version
  if (frameworkVersion && config.detection.getVersionBucket) {
    const versionBucket = config.detection.getVersionBucket(frameworkVersion);
    analytics.setTag(`${config.metadata.integration}-version`, versionBucket);
  }

  analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: config.metadata.integration,
  });

  // Get WorkOS credentials (API key optional for client-only SDKs)
  const { apiKey, clientId } = await getOrAskForWorkOSCredentials(options, config.environment.requiresApiKey);

  // Check if caller (state machine) already configured WorkOS environment
  // If credentials were passed via options, the caller handled config+env writing
  const callerHandledConfig = Boolean(options.apiKey || options.clientId);

  // Auto-configure WorkOS environment (redirect URI, CORS, homepage)
  // Skip if caller already handled this (prevents duplicate dashboard config output)
  if (!callerHandledConfig && apiKey && config.environment.requiresApiKey) {
    const port = detectPort(config.metadata.integration, options.installDir);
    await autoConfigureWorkOSEnvironment(apiKey, config.metadata.integration, port, {
      homepageUrl: options.homepageUrl,
      redirectUri: options.redirectUri,
    });
  }

  // Gather framework-specific context (e.g., Next.js router, React Native platform)
  const frameworkContext = config.metadata.gatherContext ? await config.metadata.gatherContext(options) : {};

  // Write environment variables to .env.local BEFORE agent runs
  // Skip if caller already handled this (prevents double-writing)
  if (!callerHandledConfig) {
    const port = detectPort(config.metadata.integration, options.installDir);
    const callbackPath = getCallbackPath(config.metadata.integration);
    const redirectUri = options.redirectUri || `http://localhost:${port}${callbackPath}`;

    // Next.js requires NEXT_PUBLIC_ prefix for client-side env vars
    const redirectUriKey =
      config.metadata.integration === 'nextjs' ? 'NEXT_PUBLIC_WORKOS_REDIRECT_URI' : 'WORKOS_REDIRECT_URI';

    writeEnvLocal(options.installDir, {
      ...(apiKey ? { WORKOS_API_KEY: apiKey } : {}),
      WORKOS_CLIENT_ID: clientId,
      [redirectUriKey]: redirectUri,
    });
  }

  // Set analytics tags from framework context
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  // Build integration prompt (credentials are already in .env.local)
  const integrationPrompt = await buildIntegrationPrompt(
    config,
    {
      frameworkVersion: frameworkVersion || 'latest',
      typescript: typeScriptDetected,
    },
    frameworkContext,
  );

  // Initialize and run agent
  // Spinner is now handled by adapters listening to agent:start/agent:progress events
  const agent = await initializeAgent(
    {
      workingDirectory: options.installDir,
      workOSApiKey: apiKey,
      workOSApiHost: 'https://api.workos.com',
    },
    options,
  );

  const integration = config.metadata.integration;

  const retryConfig: RetryConfig | undefined = options.noValidate
    ? undefined
    : {
        maxRetries: options.maxRetries ?? 2,
        // Self-correction combines two layers: build/typecheck (existing) AND the
        // security subset of doctor's auth-pattern checks. The latter is what was
        // missing — it's why an insecure GET sign-out could pass the build and
        // ship as a "successful" install. Only error-severity security findings
        // force a retry; warning findings ride along in the prompt only when a
        // retry is already triggered by an error or a build failure (warnings are
        // still surfaced in the final validation report regardless).
        validateAndFormat: async (workingDirectory: string) => {
          const quickPrompt = await quickCheckValidateAndFormat(workingDirectory);
          const security = await runInstallSecurityChecks(integration, workingDirectory);
          if (quickPrompt === null && security.blocking.length === 0) return null;
          return [quickPrompt, formatSecurityFindingsForAgent(security.findings)]
            .filter((p): p is string => Boolean(p))
            .join('\n\n');
        },
      };

  // Run agent with retry support — agent gets correction prompts on validation failure
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
    retryConfig,
  );

  // If agent returned an error, throw so state machine can handle it
  if (agentResult.error) {
    await analytics.shutdown('error');
    const message = agentResult.errorMessage || agentResult.error;
    // Pass user-friendly messages through without wrapping them in
    // "Agent SDK error:" — that prefix obscures the actionable text.
    throw new Error(message);
  }

  // Run full validation after agent (with retries) completes
  // Quick checks already ran inside the retry loop — skip build
  if (!options.noValidate) {
    options.emitter?.emit('validation:start', { framework: integration });

    const validationResult = await validateInstallation(integration, options.installDir, {
      runBuild: false,
    });

    // Run doctor's security subset as the final gate. Its absence here is the
    // install-validate ↔ doctor gap: install reported success while `workos
    // doctor` immediately found a SIGNOUT_GET_HANDLER hole.
    const security = await runInstallSecurityChecks(integration, options.installDir);
    const allIssues = [...validationResult.issues, ...securityFindingsToIssues(security.findings)];

    if (allIssues.length > 0) {
      options.emitter?.emit('validation:issues', { issues: allIssues });
    }

    options.emitter?.emit('validation:complete', {
      passed: validationResult.passed && security.blocking.length === 0,
      issueCount: allIssues.length,
      durationMs: validationResult.durationMs,
    });

    // Block success: an error-severity security finding that survived the
    // self-correction retries fails the install rather than shipping silently.
    // Throwing routes through the state machine's error state (success: false,
    // non-zero exit) and skips the commit/PR steps, leaving the insecure code
    // uncommitted for the user to inspect.
    if (security.blocking.length > 0) {
      analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
        action: 'security gate blocked install',
        integration,
        codes: security.blocking.map((f) => f.code).join(','),
      });
      await analytics.shutdown('error');
      throw new Error(formatBlockingSecurityError(security.blocking));
    }
  }

  // Track retry metrics AFTER the security gate. `passed_after_retry` must
  // reflect a genuinely successful install, not just an exhausted retry loop —
  // emitting it before the gate could pair a "passed after retry" event with a
  // "security gate blocked install" failure for the same run.
  if (agentResult.retryCount !== undefined && agentResult.retryCount > 0) {
    analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
      action: 'agent retry summary',
      retry_count: agentResult.retryCount,
      max_retries: options.maxRetries ?? 2,
      passed_after_retry: true,
    });
  }

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

  const changes = [
    ...config.ui.getOutroChanges(frameworkContext),
    Object.keys(envVars).length > 0 ? `Added environment variables to .env file` : '',
    uploadedEnvVars.length > 0 ? `Uploaded environment variables to your hosting provider` : '',
  ].filter(Boolean);

  const nextSteps = [
    ...config.ui.getOutroNextSteps(frameworkContext),
    uploadedEnvVars.length === 0 && config.environment.uploadToHosting
      ? `Upload your WorkOS credentials to your hosting provider`
      : '',
  ].filter(Boolean);

  const summary = buildCompletionSummary(config, changes, nextSteps);

  await analytics.shutdown('success');

  return summary;
}

/**
 * Build the integration prompt for the agent.
 * Reads reference content from @workos/skills and injects it directly into the prompt.
 * Note: Credentials are pre-written to .env.local, so not included in prompt.
 */
async function buildIntegrationPrompt(
  config: FrameworkConfig,
  context: {
    frameworkVersion: string;
    typescript: boolean;
  },
  frameworkContext: Record<string, any>,
): Promise<string> {
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];

  const additionalContext =
    additionalLines.length > 0 ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n') : '';

  const skillName = config.metadata.skillName;
  if (!skillName) {
    throw new Error(`Framework ${config.metadata.name} missing skillName in config`);
  }

  // Read reference content from @workos/skills package
  // Base template has JS-centric assumptions (node_modules, lockfiles, AuthKitProvider)
  // so only load it for JavaScript integrations; backend SDKs bypass this entirely
  const isJavaScript = config.metadata.language === 'javascript';
  const [baseContent, refContent] = await Promise.all([
    isJavaScript ? getReference('workos-authkit-base') : Promise.resolve(''),
    getReference(skillName),
  ]);

  // Build env var list dynamically based on what was actually configured
  const envVars = [
    ...(config.environment.requiresApiKey ? ['WORKOS_API_KEY'] : []),
    'WORKOS_CLIENT_ID',
    config.metadata.integration === 'nextjs' ? 'NEXT_PUBLIC_WORKOS_REDIRECT_URI' : 'WORKOS_REDIRECT_URI',
    'WORKOS_COOKIE_PASSWORD',
  ];
  const envVarList = envVars.map((v) => `- ${v}`).join('\n');

  return `You are integrating WorkOS AuthKit into this ${config.metadata.name} application.

## Project Context

- Framework: ${config.metadata.name} ${context.frameworkVersion}
- TypeScript: ${context.typescript ? 'Yes' : 'No'}${additionalContext}

## Environment

The following environment variables have been configured in .env.local:
${envVarList}

${baseContent ? `## General Guidelines\n\n${baseContent}\n\n` : ''}## Integration Instructions

${refContent}

Report your progress using [STATUS] prefixes.

Begin integration now.`;
}

function buildCompletionSummary(config: FrameworkConfig, changes: string[], nextSteps: string[]): string {
  const lines: string[] = ['Successfully installed WorkOS AuthKit!', ''];

  if (changes.length > 0) {
    lines.push('What the agent did:');
    for (const change of changes) lines.push(`• ${change}`);
    lines.push('');
  }

  if (nextSteps.length > 0) {
    lines.push('Next steps:');
    for (const step of nextSteps) lines.push(`• ${step}`);
    lines.push('');
  }

  lines.push(
    `Learn more: ${config.metadata.docsUrl}`,
    '',
    'Note: This installer uses an LLM agent to analyze and modify your project. Please review the changes made.',
  );

  return lines.join('\n');
}
