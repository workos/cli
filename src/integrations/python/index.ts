/* Python/Django integration — auto-discovered by registry */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { analytics } from '../../utils/analytics.js';
import { INSTALLER_INTERACTION_EVENT_NAME } from '../../lib/constants.js';
import { parseEnvFile } from '../../utils/env-parser.js';

/**
 * Detect which Python package manager the project uses.
 */
function detectPythonPackageManager(installDir: string): { name: string; installCmd: string } {
  if (existsSync(join(installDir, 'uv.lock'))) {
    return { name: 'uv', installCmd: 'uv add' };
  }

  if (existsSync(join(installDir, 'pyproject.toml'))) {
    try {
      const content = readFileSync(join(installDir, 'pyproject.toml'), 'utf-8');
      if (content.includes('[tool.poetry]')) {
        return { name: 'poetry', installCmd: 'poetry add' };
      }
    } catch {
      /* ignore */
    }
  }

  if (existsSync(join(installDir, 'Pipfile'))) {
    return { name: 'pipenv', installCmd: 'pipenv install' };
  }

  return { name: 'pip', installCmd: 'pip install' };
}

/**
 * Detect if this is a Django project.
 */
function isDjangoProject(installDir: string): boolean {
  if (existsSync(join(installDir, 'manage.py'))) return true;

  const pyprojectPath = join(installDir, 'pyproject.toml');
  if (existsSync(pyprojectPath)) {
    try {
      const content = readFileSync(pyprojectPath, 'utf-8');
      if (/django/i.test(content)) return true;
    } catch {
      /* ignore */
    }
  }

  const reqPath = join(installDir, 'requirements.txt');
  if (existsSync(reqPath)) {
    try {
      const content = readFileSync(reqPath, 'utf-8');
      if (/^django/im.test(content)) return true;
    } catch {
      /* ignore */
    }
  }

  return false;
}

/**
 * Write .env file for Python projects (not .env.local).
 * Merges with existing .env. No cookie password generation.
 */
function writeEnvFile(installDir: string, envVars: Record<string, string>): void {
  const envPath = join(installDir, '.env');

  let existingEnv: Record<string, string> = {};
  if (existsSync(envPath)) {
    try {
      existingEnv = parseEnvFile(readFileSync(envPath, 'utf-8'));
    } catch {
      /* ignore */
    }
  }

  const merged = { ...existingEnv, ...envVars };
  const content = Object.entries(merged)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  writeFileSync(envPath, content + '\n');
}

export const config: FrameworkConfig = {
  metadata: {
    name: 'Python (Django)',
    integration: 'python',
    docsUrl: 'https://workos.com/docs/user-management/authkit/vanilla/python',
    skillName: 'workos-python',
    language: 'python',
    stability: 'experimental',
    priority: 60,
    packageManager: 'pip',
    manifestFile: 'pyproject.toml',
    gatherContext: async (options: InstallerOptions) => {
      const pkgMgr = detectPythonPackageManager(options.installDir);
      return {
        packageManager: pkgMgr.name,
        installCommand: pkgMgr.installCmd,
        isDjango: isDjangoProject(options.installDir),
      };
    },
  },

  detection: {
    // Dummy values for FrameworkDetection interface compat — Python doesn't use package.json
    packageName: 'workos',
    packageDisplayName: 'Python (Django)',
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
    getTags: (context: any) => ({
      'python-package-manager': context?.packageManager || 'unknown',
      'python-is-django': String(context?.isDjango ?? false),
    }),
  },

  prompts: {
    getAdditionalContextLines: (context: any) => {
      const lines: string[] = [];
      if (context?.packageManager) lines.push(`Package manager: ${context.packageManager}`);
      if (context?.installCommand) lines.push(`Install command: ${context.installCommand}`);
      if (context?.isDjango) lines.push('Framework: Django');
      return lines;
    },
  },

  ui: {
    successMessage: 'WorkOS AuthKit integration complete',
    getOutroChanges: () => [
      'Analyzed your Python/Django project structure',
      'Installed WorkOS Python SDK',
      'Created authentication views (login, callback, logout)',
      'Configured URL routing and environment variables',
    ],
    getOutroNextSteps: () => [
      'Run `python manage.py runserver` to test authentication',
      'Visit http://localhost:8000/auth/login to test the login flow',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

/**
 * Build the agent prompt for Python/Django integration.
 */
function buildPythonPrompt(frameworkContext: Record<string, any>): string {
  const contextLines = ['- Framework: Python (Django)'];
  if (frameworkContext.packageManager) contextLines.push(`- Package manager: ${frameworkContext.packageManager}`);
  if (frameworkContext.installCommand) contextLines.push(`- Install command: ${frameworkContext.installCommand}`);

  const skillName = config.metadata.skillName!;

  return `You are integrating WorkOS AuthKit into this Python/Django application.

## Project Context

${contextLines.join('\n')}

## Environment

The following environment variables have been configured in .env:
- WORKOS_API_KEY
- WORKOS_CLIENT_ID

## Your Task

Use the \`${skillName}\` skill to integrate WorkOS AuthKit into this application.

The skill contains step-by-step instructions including:
1. Fetching the SDK documentation
2. Installing the SDK and python-dotenv
3. Configuring Django settings
4. Creating authentication views
5. Setting up URL routing
6. Adding authentication UI

Report your progress using [STATUS] prefixes.

Begin by invoking the ${skillName} skill.`;
}

/**
 * Custom run function that bypasses runAgentInstaller.
 * Calls initializeAgent + runAgent directly, handling Python-specific
 * env writing and prompt building.
 */
export async function run(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  options.emitter?.emit('status', {
    message: 'Setting up WorkOS AuthKit for Python (Django)',
  });

  const apiKey = options.apiKey || '';
  const clientId = options.clientId || '';

  // Gather Python-specific context
  const frameworkContext = config.metadata.gatherContext ? await config.metadata.gatherContext(options) : {};

  analytics.capture(INSTALLER_INTERACTION_EVENT_NAME, {
    action: 'started agent integration',
    integration: 'python',
  });

  // Set analytics tags
  const contextTags = config.analytics.getTags(frameworkContext);
  for (const [key, value] of Object.entries(contextTags)) {
    analytics.setTag(key, value);
  }

  // Write .env (not .env.local) with WorkOS credentials
  writeEnvFile(options.installDir, {
    ...(apiKey ? { WORKOS_API_KEY: apiKey } : {}),
    WORKOS_CLIENT_ID: clientId,
  });

  // Build Python-specific prompt
  const prompt = buildPythonPrompt(frameworkContext);

  // Initialize and run agent directly (bypass runAgentInstaller)
  const { initializeAgent, runAgent } = await import('../../lib/agent-interface.js');

  const agentConfig = await initializeAgent(
    {
      workingDirectory: options.installDir,
      workOSApiKey: apiKey,
      workOSApiHost: 'https://api.workos.com',
    },
    options,
  );

  const result = await runAgent(
    agentConfig,
    prompt,
    options,
    {
      spinnerMessage: 'Setting up WorkOS AuthKit for Python/Django...',
      successMessage: config.ui.successMessage,
      errorMessage: 'Python integration failed',
    },
    options.emitter,
  );

  if (result.error) {
    await analytics.shutdown('error');
    throw new Error(`Agent error: ${result.errorMessage || result.error}`);
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
