/* Kotlin (Spring Boot) integration — auto-discovered by registry */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';

function hasKotlinContent(path: string, pattern: RegExp): boolean {
  try {
    return pattern.test(readFileSync(path, 'utf-8'));
  } catch {
    return false;
  }
}

function isKotlinProject(installDir: string): boolean {
  const kts = join(installDir, 'build.gradle.kts');
  if (existsSync(kts) && hasKotlinContent(kts, /org\.jetbrains\.kotlin|kotlin\(/)) return true;

  const gradle = join(installDir, 'build.gradle');
  if (existsSync(gradle) && hasKotlinContent(gradle, /kotlin/)) return true;

  const pom = join(installDir, 'pom.xml');
  if (existsSync(pom) && hasKotlinContent(pom, /kotlin/i)) return true;

  return false;
}

export const config: FrameworkConfig = {
  metadata: {
    name: 'Kotlin (Spring Boot)',
    integration: 'kotlin',
    docsUrl: 'https://github.com/workos/workos-kotlin',
    skillName: 'workos-kotlin',
    language: 'kotlin',
    stability: 'experimental',
    priority: 40,
    packageManager: 'gradle',
    manifestFile: 'build.gradle.kts',
    // Also match Groovy DSL (build.gradle) and Maven (pom.xml) Kotlin projects.
    detect: (options) => isKotlinProject(options.installDir),
  },

  detection: {
    packageName: 'com.workos:workos-kotlin',
    packageDisplayName: 'Kotlin (Spring Boot)',
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
      'Analyzed your Kotlin/Spring Boot project structure',
      'Added WorkOS Kotlin SDK dependency to build.gradle.kts',
      'Created authentication controller with login, callback, and logout endpoints',
      'Configured application.properties with WorkOS credentials',
    ],
    getOutroNextSteps: () => [
      'Run ./gradlew bootRun to start your application',
      'Visit http://localhost:8080/auth/login to test authentication',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

export async function run(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  const { runAgentInstaller } = await import('../../lib/agent-runner.js');
  return runAgentInstaller(config, options);
}
