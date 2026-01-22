/* Simplified Next.js wizard using Claude Agent SDK with WorkOS MCP */
import type { WizardOptions } from '../utils/types.js';
import { enableDebugLogs } from '../utils/debug.js';
import { runAgentWizard } from '../lib/agent-runner.js';
import { Integration } from '../lib/constants.js';
import { getPackageVersion } from '../utils/package-json.js';
import { getPackageDotJson } from '../utils/clack-utils.js';
import clack from '../utils/clack.js';
import chalk from 'chalk';
import * as semver from 'semver';
import { getNextJsRouter, getNextJsVersionBucket, getNextJsRouterName, NextJsRouter } from './utils.js';

/**
 * Next.js framework configuration for the universal agent runner.
 */
const MINIMUM_NEXTJS_VERSION = '15.3.0';

const NEXTJS_AGENT_CONFIG = {
  metadata: {
    name: 'Next.js',
    integration: Integration.nextjs,
    docsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
    skillName: 'workos-authkit-nextjs',
    gatherContext: async (options: WizardOptions) => {
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
    requiresApiKey: true, // Server-side framework
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
    getOutroNextSteps: () => {
      return [
        'Start your development server to test authentication',
        'Visit the WorkOS Dashboard to manage users and settings',
      ];
    },
  },
};

/**
 * Next.js wizard powered by the universal agent runner.
 * @returns Summary of what was done, or empty string if version check fails
 */
export async function runNextjsWizardAgent(options: WizardOptions): Promise<string> {
  if (options.debug) {
    enableDebugLogs();
  }

  // Check Next.js version - agent wizard requires >= 15.3.0
  const packageJson = await getPackageDotJson(options);
  const nextVersion = getPackageVersion('next', packageJson);

  if (nextVersion) {
    const coercedVersion = semver.coerce(nextVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_NEXTJS_VERSION)) {
      const docsUrl = NEXTJS_AGENT_CONFIG.metadata.unsupportedVersionDocsUrl ?? NEXTJS_AGENT_CONFIG.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the wizard can't help you with Next.js ${nextVersion}. Upgrade to Next.js ${MINIMUM_NEXTJS_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup Next.js manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('WorkOS AuthKit wizard will see you next time!');
      return '';
    }
  }

  return runAgentWizard(NEXTJS_AGENT_CONFIG, options);
}
