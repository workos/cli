/* Kotlin (Spring Boot) integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';

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
