/* Go integration — auto-discovered by registry */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkConfig } from '../../lib/framework-config.js';
import { SPINNER_MESSAGE } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { getOrAskForWorkOSCredentials } from '../../utils/clack-utils.js';
import { autoConfigureWorkOSEnvironment } from '../../lib/workos-management.js';
import { validateInstallation } from '../../lib/validation/index.js';
import { parseEnvFile } from '../../utils/env-parser.js';

/** Default port for Go HTTP servers */
const GO_DEFAULT_PORT = 8080;
const GO_CALLBACK_PATH = '/auth/callback';

/**
 * Detect whether go.mod includes the Gin web framework.
 */
function detectGoFramework(installDir: string): 'gin' | 'stdlib' {
  try {
    const goMod = readFileSync(join(installDir, 'go.mod'), 'utf-8');
    return goMod.includes('github.com/gin-gonic/gin') ? 'gin' : 'stdlib';
  } catch {
    return 'stdlib';
  }
}

/**
 * Write environment variables to .env (Go convention, not .env.local).
 * Merges with existing .env if present.
 */
function writeGoEnv(installDir: string, envVars: Record<string, string>): void {
  const envPath = join(installDir, '.env');
  let existing: Record<string, string> = {};

  if (existsSync(envPath)) {
    existing = parseEnvFile(readFileSync(envPath, 'utf-8'));
  }

  const merged = { ...existing, ...envVars };
  const content = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync(envPath, content + '\n');
}

export const config: FrameworkConfig = {
  metadata: {
    name: 'Go',
    integration: 'go',
    docsUrl: 'https://workos.com/docs/authkit/vanilla/go',
    skillName: 'workos-go',
    language: 'go',
    stability: 'experimental',
    priority: 50,
    packageManager: 'go',
    manifestFile: 'go.mod',
    gatherContext: async (options) => {
      return { framework: detectGoFramework(options.installDir) };
    },
  },

  detection: {
    packageName: 'github.com/workos/workos-go/v4',
    packageDisplayName: 'Go',
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
    getTags: (context: any) => (context?.framework ? { 'go-framework': context.framework } : {}),
  },

  prompts: {
    getAdditionalContextLines: (context: any) => [
      ...(context?.framework ? [`Go web framework: ${context.framework}`] : []),
    ],
  },

  ui: {
    successMessage: 'WorkOS AuthKit integration complete',
    getOutroChanges: () => [
      'Analyzed your Go project structure',
      'Installed workos-go SDK',
      'Created authentication handlers',
      'Configured environment variables',
    ],
    getOutroNextSteps: () => [
      'Run `go run .` to start your server',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

/**
 * Run the Go integration.
 *
 * Custom flow that bypasses runAgentInstaller because the universal runner
 * assumes package.json exists (getPackageDotJson aborts without it) and
 * port-detection/env-writer are JS-specific.
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

  // Auto-configure WorkOS environment (redirect URI, CORS)
  const callerHandledConfig = Boolean(options.apiKey || options.clientId);
  if (!callerHandledConfig && apiKey) {
    const redirectUri = options.redirectUri || `http://localhost:${GO_DEFAULT_PORT}${GO_CALLBACK_PATH}`;
    await autoConfigureWorkOSEnvironment(apiKey, config.metadata.integration, GO_DEFAULT_PORT, {
      homepageUrl: options.homepageUrl,
      redirectUri,
    });
  }

  // Gather Go-specific context
  const frameworkContext = config.metadata.gatherContext ? await config.metadata.gatherContext(options) : {};

  // Write .env (not .env.local — Go convention)
  if (!callerHandledConfig) {
    const redirectUri = options.redirectUri || `http://localhost:${GO_DEFAULT_PORT}${GO_CALLBACK_PATH}`;
    writeGoEnv(options.installDir, {
      ...(apiKey ? { WORKOS_API_KEY: apiKey } : {}),
      WORKOS_CLIENT_ID: clientId,
      WORKOS_REDIRECT_URI: redirectUri,
    });
  }

  // Set analytics tags
  const contextTags = config.analytics.getTags(frameworkContext);
  Object.entries(contextTags).forEach(([key, value]) => {
    analytics.setTag(key, value);
  });

  // Build prompt
  const additionalLines = config.prompts.getAdditionalContextLines
    ? config.prompts.getAdditionalContextLines(frameworkContext)
    : [];
  const additionalContext =
    additionalLines.length > 0 ? '\n' + additionalLines.map((line) => `- ${line}`).join('\n') : '';

  const skillName = config.metadata.skillName!;
  const integrationPrompt = `You are integrating WorkOS AuthKit into this ${config.metadata.name} application.

## Project Context

- Language: Go
- Framework: ${frameworkContext.framework === 'gin' ? 'Gin' : 'stdlib net/http'}${additionalContext}

## Environment

The following environment variables have been configured in .env:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID
- WORKOS_REDIRECT_URI

## Your Task

Use the \`${skillName}\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Installing the SDK
3. Detecting Gin vs stdlib
4. Creating authentication handlers
5. Wiring handlers into the router
6. Verification with go build and go vet

Report your progress using [STATUS] prefixes.

Begin by invoking the ${skillName} skill.`;

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

  // Post-installation validation (gracefully skips — no rules file for Go)
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

  // Build summary
  const changes = config.ui.getOutroChanges(frameworkContext).filter(Boolean);
  const nextSteps = config.ui.getOutroNextSteps(frameworkContext).filter(Boolean);

  const lines: string[] = [
    'Successfully installed WorkOS AuthKit!',
    '',
    ...(changes.length > 0 ? ['What the agent did:', ...changes.map((c) => `• ${c}`), ''] : []),
    ...(nextSteps.length > 0 ? ['Next steps:', ...nextSteps.map((s) => `• ${s}`), ''] : []),
    `Learn more: ${config.metadata.docsUrl}`,
    '',
    'Note: This installer uses an LLM agent to analyze and modify your project. Please review the changes made.',
  ];

  await analytics.shutdown('success');

  return lines.join('\n');
}
