/* Next.js integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { getPackageVersion } from '../../utils/package-json.js';
import { getPackageDotJson } from '../../utils/clack-utils.js';
import clack from '../../utils/clack.js';
import chalk from 'chalk';
import * as semver from 'semver';
import { getNextJsRouter, getNextJsVersionBucket, getNextJsRouterName, NextJsRouter } from './utils.js';

const MINIMUM_NEXTJS_VERSION = '15.3.0';

export const config: FrameworkConfig = {
  metadata: {
    name: 'Next.js',
    integration: 'nextjs',
    docsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
    skillName: 'workos-authkit-nextjs',
    language: 'javascript',
    stability: 'stable',
    priority: 100,
    gatherContext: async (options: InstallerOptions) => {
      const router = await getNextJsRouter(options);
      return { router };
    },
  },

  detection: {
    packageName: 'next',
    packageDisplayName: 'Next.js',
    getVersion: (packageJson: any) => getPackageVersion('next', packageJson),
    getVersionBucket: getNextJsVersionBucket,
  },

  environment: {
    uploadToHosting: true,
    requiresApiKey: true,
    getEnvVars: (apiKey: string, clientId: string) => ({
      WORKOS_API_KEY: apiKey,
      WORKOS_CLIENT_ID: clientId,
    }),
  },

  analytics: {
    getTags: (context: any) => {
      const router = context.router as NextJsRouter;
      return {
        router: router === NextJsRouter.APP_ROUTER ? 'app' : 'pages',
      };
    },
  },

  prompts: {
    getAdditionalContextLines: (context: any) => {
      const router = context.router as NextJsRouter;
      const routerType = router === NextJsRouter.APP_ROUTER ? 'app' : 'pages';
      return [`Router: ${routerType}`];
    },
  },

  ui: {
    successMessage: 'WorkOS AuthKit integration complete',
    getOutroChanges: (context: any) => {
      const router = context.router as NextJsRouter;
      const routerName = getNextJsRouterName(router);
      return [
        `Analyzed your Next.js project structure (${routerName})`,
        `Created and configured WorkOS AuthKit`,
        `Integrated authentication into your application`,
      ];
    },
    getOutroNextSteps: () => [
      'Start your development server to test authentication',
      'Visit the WorkOS Dashboard to manage users and settings',
    ],
  },
};

export async function run(options: InstallerOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Check Next.js version - agent wizard requires >= 15.3.0
  const packageJson = await getPackageDotJson(options);
  const nextVersion = getPackageVersion('next', packageJson);

  if (nextVersion) {
    const coercedVersion = semver.coerce(nextVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_NEXTJS_VERSION)) {
      const docsUrl = config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the installer can't help you with Next.js ${nextVersion}. Upgrade to Next.js ${MINIMUM_NEXTJS_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup Next.js manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('WorkOS AuthKit installer will see you next time!');
      return '';
    }
  }

  const { runAgentInstaller } = await import('../../lib/agent-runner.js');
  return runAgentInstaller(config, options);
}
