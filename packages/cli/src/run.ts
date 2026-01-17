import { abortIfCancelled } from './utils/clack-utils.js';

import { runNextjsWizardAgent } from './nextjs/nextjs-wizard-agent.js';
import type { WizardOptions } from './utils/types.js';

import { getIntegrationDescription, Integration } from './lib/constants.js';
import { readEnvironment } from './utils/environment.js';
import clack from './utils/clack.js';
import path from 'path';
import { INTEGRATION_CONFIG, INTEGRATION_ORDER } from './lib/config.js';
import { runReactWizardAgent } from './react/react-wizard-agent.js';
import { analytics } from './utils/analytics.js';
import { runReactRouterWizardAgent } from './react-router/react-router-wizard-agent.js';
import { runTanstackStartWizardAgent } from './tanstack-start/tanstack-start-wizard-agent.js';
import { runVanillaJsWizardAgent } from './vanilla-js/vanilla-js-wizard-agent.js';
import { EventEmitter } from 'events';
import chalk from 'chalk';
import { RateLimitError } from './utils/errors.js';
import { getSettings } from './lib/settings.js';

EventEmitter.defaultMaxListeners = 50;

type Args = {
  integration?: Integration;
  debug?: boolean;
  forceInstall?: boolean;
  installDir?: string;
  default?: boolean;
  local?: boolean;
  ci?: boolean;
  apiKey?: string;
  clientId?: string;
  homepageUrl?: string;
  redirectUri?: string;
};

export async function runWizard(argv: Args) {
  const finalArgs = {
    ...argv,
    ...readEnvironment(),
  };

  let resolvedInstallDir: string;
  if (finalArgs.installDir) {
    if (path.isAbsolute(finalArgs.installDir)) {
      resolvedInstallDir = finalArgs.installDir;
    } else {
      resolvedInstallDir = path.join(process.cwd(), finalArgs.installDir);
    }
  } else {
    resolvedInstallDir = process.cwd();
  }

  const wizardOptions: WizardOptions = {
    debug: finalArgs.debug ?? false,
    forceInstall: finalArgs.forceInstall ?? false,
    installDir: resolvedInstallDir,
    default: finalArgs.default ?? false,
    local: finalArgs.local ?? false,
    ci: finalArgs.ci ?? false,
    apiKey: finalArgs.apiKey,
    clientId: finalArgs.clientId,
    homepageUrl: finalArgs.homepageUrl,
    redirectUri: finalArgs.redirectUri,
  };

  const settings = getSettings();
  if (settings.branding.showAsciiArt) {
    console.log(chalk.cyan(settings.branding.asciiArt));
    console.log();
  } else {
    clack.intro(`Welcome to the WorkOS AuthKit setup wizard ✨`);
  }

  if (wizardOptions.ci) {
    clack.log.info(chalk.dim('Running in CI mode'));
  }

  const integration =
    finalArgs.integration ?? (await getIntegrationForSetup(wizardOptions));

  analytics.setTag('integration', integration);

  try {
    switch (integration) {
      case Integration.nextjs:
        await runNextjsWizardAgent(wizardOptions);
        break;
      case Integration.react:
        await runReactWizardAgent(wizardOptions);
        break;
      case Integration.tanstackStart:
        await runTanstackStartWizardAgent(wizardOptions);
        break;
      case Integration.reactRouter:
        await runReactRouterWizardAgent(wizardOptions);
        break;
      case Integration.vanillaJs:
        await runVanillaJsWizardAgent(wizardOptions);
        break;
      default:
        clack.log.error('No setup wizard selected!');
    }
  } catch (error) {
    analytics.captureException(error as Error, {
      integration,
      arguments: JSON.stringify(finalArgs),
    });

    await analytics.shutdown('error');

    if (error instanceof RateLimitError) {
      clack.log.error('Wizard usage limit reached. Please try again later.');
    } else {
      clack.log.error(
        `Something went wrong. You can read the documentation at ${chalk.cyan(
          `${INTEGRATION_CONFIG[integration].docsUrl}`,
        )} to set up WorkOS AuthKit manually.`,
      );
    }
    process.exit(1);
  }
}

async function detectIntegration(
  options: Pick<WizardOptions, 'installDir'>,
): Promise<Integration | undefined> {
  const integrationConfigs = Object.entries(INTEGRATION_CONFIG).sort(
    ([a], [b]) =>
      INTEGRATION_ORDER.indexOf(a as Integration) -
      INTEGRATION_ORDER.indexOf(b as Integration),
  );

  for (const [integration, config] of integrationConfigs) {
    const detected = await config.detect(options);
    if (detected) {
      return integration as Integration;
    }
  }
}

async function getIntegrationForSetup(
  options: Pick<WizardOptions, 'installDir'>,
) {
  const detectedIntegration = await detectIntegration(options);

  if (detectedIntegration) {
    clack.log.success(
      `Detected integration: ${getIntegrationDescription(detectedIntegration)}`,
    );
    return detectedIntegration;
  }

  const integration: Integration = await abortIfCancelled(
    clack.select({
      message: 'What do you want to set up?',
      options: [
        { value: Integration.nextjs, label: 'Next.js' },
        { value: Integration.tanstackStart, label: 'TanStack Start' },
        { value: Integration.reactRouter, label: 'React Router' },
        { value: Integration.react, label: 'React (SPA)' },
        { value: Integration.vanillaJs, label: 'Vanilla JavaScript' },
      ],
    }),
  );

  return integration;
}
