import { createActor, fromPromise } from 'xstate';
import { wizardMachine } from './wizard-core.js';
import { createWizardEventEmitter } from './events.js';
import { CLIAdapter } from './adapters/cli-adapter.js';
import { DashboardAdapter } from './adapters/dashboard-adapter.js';
import type { WizardAdapter } from './adapters/types.js';
import type { WizardOptions } from '../utils/types.js';
import type { WizardMachineContext, DetectionOutput, GitCheckOutput, AgentOutput } from './wizard-core.types.js';
import { Integration } from './constants.js';

// Import existing utilities for actor implementations
import { getAccessToken } from './credentials.js';
import { runLogin } from '../commands/login.js';
import { isInGitRepo, getUncommittedOrUntrackedFiles } from '../utils/clack-utils.js';
import { INTEGRATION_CONFIG, INTEGRATION_ORDER } from './config.js';
import { autoConfigureWorkOSEnvironment } from './workos-management.js';
import { detectPort, getCallbackPath } from './port-detection.js';
import { writeEnvLocal } from './env-writer.js';

// Import framework-specific wizard agents
import { runNextjsWizardAgent } from '../nextjs/nextjs-wizard-agent.js';
import { runReactWizardAgent } from '../react/react-wizard-agent.js';
import { runReactRouterWizardAgent } from '../react-router/react-router-wizard-agent.js';
import { runTanstackStartWizardAgent } from '../tanstack-start/tanstack-start-wizard-agent.js';
import { runVanillaJsWizardAgent } from '../vanilla-js/vanilla-js-wizard-agent.js';

/**
 * Run the appropriate framework wizard based on integration type.
 */
async function runIntegrationWizardFn(integration: Integration, options: WizardOptions): Promise<void> {
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

/**
 * Detect integration from project files.
 */
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

/**
 * Run the wizard using the headless core architecture.
 *
 * This is the unified entry point that:
 * 1. Creates the event emitter
 * 2. Creates the appropriate UI adapter
 * 3. Provides real implementations to the machine
 * 4. Starts the machine and awaits completion
 */
export async function runWithCore(options: WizardOptions): Promise<void> {
  // Create the event emitter
  const emitter = createWizardEventEmitter();

  // Track the actor so adapters can send events
  let actor: ReturnType<typeof createActor<typeof wizardMachine>> | null = null;

  const sendEvent = (event: { type: string; [key: string]: unknown }) => {
    if (actor) {
      actor.send(event as Parameters<typeof actor.send>[0]);
    }
  };

  // Create the appropriate adapter
  const adapter: WizardAdapter = options.dashboard
    ? new DashboardAdapter({ emitter, sendEvent })
    : new CLIAdapter({ emitter, sendEvent });

  // Provide real implementations for machine actors
  const machineWithActors = wizardMachine.provide({
    actors: {
      /**
       * Check if user is authenticated, perform login if needed.
       */
      checkAuthentication: fromPromise(async () => {
        const token = getAccessToken();
        if (token) {
          return true;
        }

        // Trigger login flow
        await runLogin();

        // Check again
        const newToken = getAccessToken();
        if (!newToken) {
          throw new Error('Authentication failed. Please try again.');
        }

        return true;
      }),

      /**
       * Detect the framework integration from project files.
       */
      detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async ({ input }) => {
        const integration = await detectIntegrationFn({
          installDir: input.options.installDir,
        });
        return { integration };
      }),

      /**
       * Check git status for uncommitted/untracked files.
       */
      checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => {
        // If not in a git repo, treat as clean
        if (!isInGitRepo()) {
          return { isClean: true, files: [] };
        }

        const files = getUncommittedOrUntrackedFiles();
        return {
          isClean: files.length === 0,
          files,
        };
      }),

      /**
       * Configure environment: write .env.local, auto-configure WorkOS.
       */
      configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async ({ input }) => {
        const { context } = input;
        const { options: wizardOptions, integration, credentials } = context;

        if (!integration || !credentials) {
          throw new Error('Missing integration or credentials');
        }

        // Detect port for redirect URI
        const port = detectPort(integration, wizardOptions.installDir);
        const callbackPath = getCallbackPath(integration);
        const redirectUri = wizardOptions.redirectUri || `http://localhost:${port}${callbackPath}`;

        // Auto-configure WorkOS (redirect URI, CORS, homepage)
        const requiresApiKey = [Integration.nextjs, Integration.tanstackStart, Integration.reactRouter].includes(
          integration,
        );
        if (credentials.apiKey && requiresApiKey) {
          await autoConfigureWorkOSEnvironment(credentials.apiKey, integration, port, {
            homepageUrl: wizardOptions.homepageUrl,
            redirectUri: wizardOptions.redirectUri,
          });
        }

        // Write .env.local
        const redirectUriKey =
          integration === Integration.nextjs ? 'NEXT_PUBLIC_WORKOS_REDIRECT_URI' : 'WORKOS_REDIRECT_URI';

        writeEnvLocal(wizardOptions.installDir, {
          ...(credentials.apiKey ? { WORKOS_API_KEY: credentials.apiKey } : {}),
          WORKOS_CLIENT_ID: credentials.clientId,
          [redirectUriKey]: redirectUri,
        });
      }),

      /**
       * Run the AI agent to perform the integration.
       */
      runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async ({ input }) => {
        const { context } = input;
        const { options: wizardOptions, integration, credentials } = context;

        if (!integration) {
          return { success: false, error: new Error('No integration specified') };
        }

        try {
          // Update options with credentials for the agent
          const agentOptions: WizardOptions = {
            ...wizardOptions,
            apiKey: credentials?.apiKey,
            clientId: credentials?.clientId,
            emitter: context.emitter,
          };

          await runIntegrationWizardFn(integration, agentOptions);

          return {
            success: true,
            summary: `Successfully installed WorkOS AuthKit for ${integration}!`,
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

  // Create the actor
  actor = createActor(machineWithActors, {
    input: { emitter, options },
  });

  // Start the adapter
  await adapter.start();

  try {
    // Wait for the machine to reach a terminal state
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

      // Start the machine
      actor!.start();
      actor!.send({ type: 'START' });
    });
  } finally {
    // Always stop the adapter
    await adapter.stop();
  }
}
