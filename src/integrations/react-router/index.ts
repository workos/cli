/* React Router integration — auto-discovered by registry */
import type { FrameworkConfig } from '../../lib/framework-config.js';
import type { InstallerOptions } from '../../utils/types.js';
import { enableDebugLogs } from '../../utils/debug.js';
import { getPackageVersion } from '../../utils/package-json.js';
import { getPackageDotJson } from '../../utils/clack-utils.js';
import clack from '../../utils/clack.js';
import chalk from 'chalk';
import * as semver from 'semver';
import { getReactRouterMode, getReactRouterModeName, getReactRouterVersionBucket, ReactRouterMode } from './utils.js';

const MINIMUM_REACT_ROUTER_VERSION = '6.0.0';

export const config: FrameworkConfig = {
  metadata: {
    name: 'React Router',
    integration: 'react-router',
    docsUrl: 'https://workos.com/docs/user-management/authkit/react-router',
    unsupportedVersionDocsUrl: 'https://workos.com/docs/user-management/authkit/react-router',
    skillName: 'workos-authkit-react-router',
    language: 'javascript',
    stability: 'stable',
    priority: 80,
    gatherContext: async (options: InstallerOptions) => {
      const routerMode = await getReactRouterMode(options);
      return { routerMode };
    },
  },

  detection: {
    packageName: 'react-router',
    packageDisplayName: 'React Router',
    getVersion: (packageJson: any) => getPackageVersion('react-router', packageJson),
    getVersionBucket: getReactRouterVersionBucket,
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
    getTags: (context: any) => {
      const routerMode = context.routerMode as ReactRouterMode;
      return { routerMode: routerMode || 'unknown' };
    },
  },

  prompts: {
    getAdditionalContextLines: (context: any) => {
      const routerMode = context.routerMode as ReactRouterMode;
      const modeName = routerMode ? getReactRouterModeName(routerMode) : 'unknown';

      const frameworkIdMap: Record<ReactRouterMode, string> = {
        [ReactRouterMode.V6]: 'react-react-router-6',
        [ReactRouterMode.V7_FRAMEWORK]: 'react-react-router-7-framework',
        [ReactRouterMode.V7_DATA]: 'react-react-router-7-data',
        [ReactRouterMode.V7_DECLARATIVE]: 'react-react-router-7-declarative',
      };

      const frameworkId = routerMode ? frameworkIdMap[routerMode] : ReactRouterMode.V7_FRAMEWORK;

      return [`Router mode: ${modeName}`, `Framework docs ID: ${frameworkId}`];
    },
  },

  ui: {
    successMessage: 'WorkOS AuthKit integration complete',
    getOutroChanges: (context: any) => {
      const routerMode = context.routerMode as ReactRouterMode;
      const modeName = routerMode ? getReactRouterModeName(routerMode) : 'React Router';
      return [
        `Analyzed your React Router project structure (${modeName})`,
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

  const packageJson = await getPackageDotJson(options);
  const reactRouterVersion = getPackageVersion('react-router', packageJson);

  if (reactRouterVersion) {
    const coercedVersion = semver.coerce(reactRouterVersion);
    if (coercedVersion && semver.lt(coercedVersion, MINIMUM_REACT_ROUTER_VERSION)) {
      const docsUrl = config.metadata.unsupportedVersionDocsUrl ?? config.metadata.docsUrl;

      clack.log.warn(
        `Sorry: the installer can't help you with React Router ${reactRouterVersion}. Upgrade to React Router ${MINIMUM_REACT_ROUTER_VERSION} or later, or check out the manual setup guide.`,
      );
      clack.log.info(`Setup React Router manually: ${chalk.cyan(docsUrl)}`);
      clack.outro('WorkOS AuthKit installer will see you next time!');
      return '';
    }
  }

  const { runAgentInstaller } = await import('../../lib/agent-runner.js');
  return runAgentInstaller(config, options);
}
