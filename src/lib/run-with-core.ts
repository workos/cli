import { createActor, fromPromise } from 'xstate';
import open from 'opn';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { wizardMachine } from './wizard-core.js';
import { createWizardEventEmitter } from './events.js';
import { CLIAdapter } from './adapters/cli-adapter.js';
import { DashboardAdapter } from './adapters/dashboard-adapter.js';
import type { WizardAdapter } from './adapters/types.js';
import type { WizardOptions } from '../utils/types.js';
import type {
  WizardMachineContext,
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
  BranchCheckOutput,
} from './wizard-core.types.js';
import { Integration } from './constants.js';
import { parseEnvFile } from '../utils/env-parser.js';
import { enableDebugLogs, initLogFile, logInfo, logError } from '../utils/debug.js';

import {
  getAccessToken,
  getCredentials,
  saveCredentials,
  getStagingCredentials,
  saveStagingCredentials,
} from './credentials.js';
import { checkForEnvFiles, discoverCredentials } from './credential-discovery.js';
import { requestDeviceCode, pollForToken } from './device-auth.js';
import { fetchStagingCredentials as fetchStagingCredentialsApi } from './staging-api.js';
import { getCliAuthClientId, getAuthkitDomain } from './settings.js';
import { analytics } from '../utils/analytics.js';
import { getVersion } from './settings.js';
import { getLlmGatewayUrlFromHost } from '../utils/urls.js';
import { isInGitRepo, getUncommittedOrUntrackedFiles } from '../utils/clack-utils.js';
import {
  getCurrentBranch,
  isProtectedBranch,
  createBranch as createGitBranch,
  branchExists,
  hasGhCli,
} from '../utils/git-utils.js';
import { detectChanges, stageAndCommit, pushBranch as pushGitBranch, createPullRequest } from './post-install.js';
import {
  generateCommitMessage as generateCommitMessageAi,
  generatePrDescription as generatePrDescriptionAi,
} from './ai-content.js';
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
  // Initialize debug/logging early so we capture all failures
  initLogFile();
  if (options.debug) {
    enableDebugLogs();
  }
  logInfo('Wizard starting with options:', {
    debug: options.debug,
    dashboard: options.dashboard,
    local: options.local,
    ci: options.ci,
    skipAuth: options.skipAuth,
    installDir: options.installDir,
  });

  // Configure telemetry endpoint (same URL as LLM gateway)
  const gatewayUrl = getLlmGatewayUrlFromHost();
  analytics.setGatewayUrl(gatewayUrl);

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
    ? new DashboardAdapter({ emitter, sendEvent, debug: augmentedOptions.debug })
    : new CLIAdapter({ emitter, sendEvent, debug: augmentedOptions.debug });

  const machineWithActors = wizardMachine.provide({
    actors: {
      checkAuthentication: fromPromise(async () => {
        const token = getAccessToken();
        if (!token) {
          // This should rarely happen since bin.ts handles auth first
          // But keep as safety net for programmatic usage
          throw new Error('Not authenticated. Run `wizard login` first.');
        }

        // Set telemetry from existing credentials
        const creds = getCredentials();
        if (creds) {
          analytics.setAccessToken(creds.accessToken);
          analytics.setDistinctId(creds.userId);
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

      // Credential discovery actors
      detectEnvFiles: fromPromise(async ({ input }) => {
        return checkForEnvFiles(input.installDir);
      }),

      scanEnvFiles: fromPromise(async ({ input }) => {
        return discoverCredentials(input.installDir);
      }),

      checkStoredAuth: fromPromise(async () => {
        const token = getAccessToken();
        return token !== null;
      }),

      runDeviceAuth: fromPromise(async ({ input }) => {
        const clientId = getCliAuthClientId();
        const authkitDomain = getAuthkitDomain();

        if (!clientId) {
          throw new Error('CLI auth not configured. Set WORKOS_CLI_CLIENT_ID environment variable.');
        }

        const deviceAuth = await requestDeviceCode({
          clientId,
          authkitDomain,
        });

        // Emit device started event with verification info
        input.emitter.emit('device:started', {
          verificationUri: deviceAuth.verification_uri,
          verificationUriComplete: deviceAuth.verification_uri_complete,
          userCode: deviceAuth.user_code,
        });

        // Open browser
        try {
          const { default: openFn } = await import('opn');
          await openFn(deviceAuth.verification_uri_complete);
        } catch {
          // User can open manually
        }

        const result = await pollForToken(deviceAuth.device_code, {
          clientId,
          authkitDomain,
          interval: deviceAuth.interval,
          onPoll: () => input.emitter.emit('device:polling', {}),
        });

        // Save the auth token
        saveCredentials({
          accessToken: result.accessToken,
          expiresAt: result.expiresAt,
          userId: result.userId,
          email: result.email,
        });

        return { result, deviceAuth };
      }),

      fetchStagingCredentials: fromPromise(async () => {
        // Check cached staging credentials first
        const cached = getStagingCredentials();
        if (cached) return cached;

        // Fetch fresh from API
        const token = getAccessToken();
        if (!token) throw new Error('No access token available');

        const staging = await fetchStagingCredentialsApi(token);
        saveStagingCredentials(staging);
        return staging;
      }),

      // Branch check actors
      checkBranch: fromPromise<BranchCheckOutput, void>(async () => {
        const branch = getCurrentBranch();
        if (!branch) {
          return { branch: null, isProtected: false };
        }
        return {
          branch,
          isProtected: isProtectedBranch(branch),
        };
      }),

      createBranch: fromPromise<{ branch: string }, { name: string; fallbackName: string }>(async ({ input }) => {
        const { name, fallbackName } = input;
        const targetBranch = branchExists(name) ? fallbackName : name;
        createGitBranch(targetBranch);
        return { branch: targetBranch };
      }),

      // Post-install actors
      detectChanges: fromPromise<{ hasChanges: boolean; files: string[] }, void>(async () => {
        return detectChanges();
      }),

      generateCommitMessage: fromPromise<string, { integration: string; files: string[] }>(async ({ input }) => {
        return generateCommitMessageAi(input.integration, input.files);
      }),

      commitChanges: fromPromise<void, { message: string; cwd: string }>(async ({ input }) => {
        stageAndCommit(input.message, input.cwd);
      }),

      generatePrDescription: fromPromise<string, { integration: string; files: string[]; commitMessage: string }>(
        async ({ input }) => {
          return generatePrDescriptionAi(input.integration, input.files, input.commitMessage);
        },
      ),

      pushBranch: fromPromise<void, { cwd: string }>(async ({ input }) => {
        pushGitBranch(input.cwd);
      }),

      createPr: fromPromise<string, { title: string; body: string; cwd: string }>(async ({ input }) => {
        return createPullRequest(input.title, input.body, input.cwd);
      }),
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let inspector: { inspect: any } | undefined;
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

    // Dynamic import - @statelyai/inspect is a devDependency
    const { createSkyInspector } = await import('@statelyai/inspect');
    inspector = createSkyInspector();
    setTimeout(() => {
      console.log = originalLog;
    }, 5000).unref();
  }

  actor = createActor(machineWithActors, {
    input: { emitter, options: augmentedOptions },
    inspect: inspector?.inspect,
  });

  await adapter.start();

  // Start telemetry session
  const mode = augmentedOptions.dashboard ? 'tui' : 'cli';
  analytics.sessionStart(mode, getVersion());

  let wizardStatus: 'success' | 'error' | 'cancelled' = 'success';

  // Handle ctrl+c by sending CANCEL to state machine for graceful shutdown
  const handleSigint = () => {
    wizardStatus = 'cancelled';
    actor?.send({ type: 'CANCEL' });
  };
  process.on('SIGINT', handleSigint);

  try {
    await new Promise<void>((resolve, reject) => {
      actor!.subscribe({
        complete: () => {
          const snapshot = actor!.getSnapshot();
          if (snapshot.value === 'error') {
            const err = snapshot.context.error;
            wizardStatus = 'error';
            reject(err ?? new Error('Wizard failed'));
          } else if (snapshot.value === 'cancelled') {
            wizardStatus = 'cancelled';
            resolve();
          } else {
            resolve();
          }
        },
        error: (err) => {
          wizardStatus = 'error';
          reject(err);
        },
      });

      actor!.start();
      actor!.send({ type: 'START' });
    });
  } catch (error) {
    wizardStatus = 'error';
    logError('Wizard failed with error:', error instanceof Error ? error.stack || error.message : String(error));
    throw error;
  } finally {
    process.off('SIGINT', handleSigint);
    await analytics.shutdown(wizardStatus);
    await adapter.stop();
  }
}
