import { createActor, fromPromise } from 'xstate';
import { createSkyInspector } from '@statelyai/inspect';
import open from 'opn';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { wizardMachine } from './wizard-core.js';
import { createWizardEventEmitter } from './events.js';
import { CLIAdapter } from './adapters/cli-adapter.js';
import { DashboardAdapter } from './adapters/dashboard-adapter.js';
import type { WizardAdapter } from './adapters/types.js';
import type { WizardOptions } from '../utils/types.js';
import type { WizardMachineContext, DetectionOutput, GitCheckOutput, AgentOutput } from './wizard-core.types.js';
import { Integration } from './constants.js';
import { parseEnvFile } from '../utils/env-parser.js';

import { getAccessToken } from './credentials.js';
import { runLogin } from '../commands/login.js';
import { isInGitRepo, getUncommittedOrUntrackedFiles } from '../utils/clack-utils.js';
import { INTEGRATION_CONFIG, INTEGRATION_ORDER } from './config.js';
import { autoConfigureWorkOSEnvironment } from './workos-management.js';
import { detectPort, getCallbackPath } from './port-detection.js';
import { writeEnvLocal } from './env-writer.js';
import { runNextjsWizardAgent } from '../nextjs/nextjs-wizard-agent.js';
import { runReactWizardAgent } from '../react/react-wizard-agent.js';
import { runReactRouterWizardAgent } from '../react-router/react-router-wizard-agent.js';
import { runTanstackStartWizardAgent } from '../tanstack-start/tanstack-start-wizard-agent.js';
import { runVanillaJsWizardAgent } from '../vanilla-js/vanilla-js-wizard-agent.js';

async function runIntegrationWizardFn(integration: Integration, options: WizardOptions): Promise<string> {
  switch (integration) {
    case Integration.nextjs:
      return runNextjsWizardAgent(options);
    case Integration.react:
      return runReactWizardAgent(options);
    case Integration.reactRouter:
      return runReactRouterWizardAgent(options);
    case Integration.tanstackStart:
      return runTanstackStartWizardAgent(options);
    case Integration.vanillaJs:
      return runVanillaJsWizardAgent(options);
    default:
      throw new Error(`Unknown integration: ${integration}`);
  }
}

function readExistingCredentials(installDir: string): { apiKey?: string; clientId?: string } {
  const envPath = join(installDir, '.env.local');
  if (!existsSync(envPath)) {
    return {};
  }

  try {
    const content = readFileSync(envPath, 'utf-8');
    const envVars = parseEnvFile(content);
    return {
      apiKey: envVars.WORKOS_API_KEY || undefined,
      clientId: envVars.WORKOS_CLIENT_ID || undefined,
    };
  } catch {
    return {};
  }
}

async function detectIntegrationFn(options: Pick<WizardOptions, 'installDir'>): Promise<Integration | undefined> {
  const integrationConfigs = Object.entries(INTEGRATION_CONFIG).sort(
    ([a], [b]) => INTEGRATION_ORDER.indexOf(a as Integration) - INTEGRATION_ORDER.indexOf(b as Integration),
  );

  for (const [integration, config] of integrationConfigs) {
    const detected = await config.detect(options);
    if (detected) {
      return integration as Integration;
    }
  }
  return undefined;
}

export async function runWithCore(options: WizardOptions): Promise<void> {
  const existingCreds = readExistingCredentials(options.installDir);
  const augmentedOptions: WizardOptions = {
    ...options,
    apiKey: options.apiKey || existingCreds.apiKey,
    clientId: options.clientId || existingCreds.clientId,
  };

  const emitter = createWizardEventEmitter();
  let actor: ReturnType<typeof createActor<typeof wizardMachine>> | null = null;

  const sendEvent = (event: { type: string; [key: string]: unknown }) => {
    if (actor) {
      actor.send(event as Parameters<typeof actor.send>[0]);
    }
  };

  const adapter: WizardAdapter = options.dashboard
    ? new DashboardAdapter({ emitter, sendEvent })
    : new CLIAdapter({ emitter, sendEvent });

  const machineWithActors = wizardMachine.provide({
    actors: {
      checkAuthentication: fromPromise(async () => {
        const token = getAccessToken();
        if (token) return true;

        await runLogin();

        const newToken = getAccessToken();
        if (!newToken) {
          throw new Error('Authentication failed. Please try again.');
        }
        return true;
      }),

      detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async ({ input }) => {
        const integration = await detectIntegrationFn({ installDir: input.options.installDir });
        return { integration };
      }),

      checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => {
        if (!isInGitRepo()) {
          return { isClean: true, files: [] };
        }
        const files = getUncommittedOrUntrackedFiles();
        return { isClean: files.length === 0, files };
      }),

      configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async ({ input }) => {
        const { context } = input;
        const { options: wizardOptions, integration, credentials } = context;

        if (!integration || !credentials) {
          throw new Error('Missing integration or credentials');
        }

        const port = detectPort(integration, wizardOptions.installDir);
        const callbackPath = getCallbackPath(integration);
        const redirectUri = wizardOptions.redirectUri || `http://localhost:${port}${callbackPath}`;

        const requiresApiKey = [Integration.nextjs, Integration.tanstackStart, Integration.reactRouter].includes(
          integration,
        );
        if (credentials.apiKey && requiresApiKey) {
          await autoConfigureWorkOSEnvironment(credentials.apiKey, integration, port, {
            homepageUrl: wizardOptions.homepageUrl,
            redirectUri: wizardOptions.redirectUri,
          });
        }

        const redirectUriKey =
          integration === Integration.nextjs ? 'NEXT_PUBLIC_WORKOS_REDIRECT_URI' : 'WORKOS_REDIRECT_URI';

        writeEnvLocal(wizardOptions.installDir, {
          ...(credentials.apiKey ? { WORKOS_API_KEY: credentials.apiKey } : {}),
          WORKOS_CLIENT_ID: credentials.clientId,
          [redirectUriKey]: redirectUri,
        });
      }),

      runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async ({ input }) => {
        const { context } = input;
        const { options: wizardOptions, integration, credentials } = context;

        if (!integration) {
          return { success: false, error: new Error('No integration specified') };
        }

        try {
          const agentOptions: WizardOptions = {
            ...wizardOptions,
            apiKey: credentials?.apiKey,
            clientId: credentials?.clientId,
            emitter: context.emitter,
          };
          const summary = await runIntegrationWizardFn(integration, agentOptions);
          return {
            success: true,
            summary: summary || `Successfully installed WorkOS AuthKit for ${integration}!`,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }),
    },
  });

  let inspector: ReturnType<typeof createSkyInspector> | undefined;
  if (augmentedOptions.inspect) {
    const originalLog = console.log;
    let inspectUrl: string | undefined;

    console.log = (...args: unknown[]) => {
      const msg = args.join(' ');
      if (typeof msg === 'string' && msg.startsWith('https://stately.ai/inspect/')) {
        inspectUrl = msg;
        console.log = originalLog;
        console.log(`Opening XState inspector: ${inspectUrl}`);
        void open(inspectUrl);
      } else {
        originalLog.apply(console, args);
      }
    };

    inspector = createSkyInspector();
    setTimeout(() => {
      console.log = originalLog;
    }, 5000);
  }

  actor = createActor(machineWithActors, {
    input: { emitter, options: augmentedOptions },
    inspect: inspector?.inspect,
  });

  await adapter.start();

  try {
    await new Promise<void>((resolve, reject) => {
      actor!.subscribe({
        complete: () => {
          const snapshot = actor!.getSnapshot();
          if (snapshot.value === 'error') {
            const err = snapshot.context.error;
            reject(err ?? new Error('Wizard failed'));
          } else {
            resolve();
          }
        },
        error: (err) => reject(err),
      });

      actor!.start();
      actor!.send({ type: 'START' });
    });
  } finally {
    await adapter.stop();
  }
}
