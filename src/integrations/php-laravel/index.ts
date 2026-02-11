/* PHP Laravel integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';

export const config: FrameworkConfig = {
  metadata: {
    name: 'PHP (Laravel)',
    integration: 'php-laravel',
    docsUrl: 'https://github.com/workos/workos-php-laravel',
    skillName: 'workos-php-laravel',
    language: 'php',
    stability: 'experimental',
    priority: 45,
    packageManager: 'composer',
    manifestFile: 'composer.json',
  },

  detection: {
    packageName: 'laravel/framework',
    packageDisplayName: 'Laravel',
    getVersion: (packageJson: any) => packageJson?.require?.['laravel/framework'],
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
      'Analyzed your Laravel project structure',
      'Installed and configured WorkOS AuthKit Laravel SDK',
      'Created authentication controller and routes',
    ],
    getOutroNextSteps: () => [
      'Run `php artisan serve` to test authentication',
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
