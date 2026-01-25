import { setup, assign, fromPromise, type ActorRefFrom } from 'xstate';
import type {
  WizardMachineContext,
  WizardMachineInput,
  WizardMachineEvent,
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
  EnvFileInfo,
  DiscoveryResult,
  CredentialSource,
} from './wizard-core.types.js';
import type { WizardOptions } from '../utils/types.js';
import type { DeviceAuthResult, DeviceAuthResponse } from './device-auth.js';
import type { StagingCredentials } from './staging-api.js';

export const wizardMachine = setup({
  types: {
    context: {} as WizardMachineContext,
    input: {} as WizardMachineInput,
    events: {} as WizardMachineEvent,
  },

  actions: {
    emitStateEnter: ({ context }, params: { state: string }) => {
      context.emitter.emit('state:enter', { state: params.state });
    },
    emitStateExit: ({ context }, params: { state: string }) => {
      context.emitter.emit('state:exit', { state: params.state });
    },
    emitAuthChecking: ({ context }) => {
      context.emitter.emit('auth:checking', {});
    },
    emitAuthRequired: ({ context }) => {
      context.emitter.emit('auth:required', {});
    },
    emitAuthSuccess: ({ context }) => {
      context.emitter.emit('auth:success', {});
    },
    emitAuthFailure: ({ context }) => {
      const message = context.error?.message ?? 'Authentication failed';
      context.emitter.emit('auth:failure', { message });
    },
    emitDetectionStart: ({ context }) => {
      context.emitter.emit('detection:start', {});
    },
    emitDetectionComplete: ({ context }) => {
      if (context.integration) {
        context.emitter.emit('detection:complete', { integration: context.integration });
      } else {
        context.emitter.emit('detection:none', {});
      }
    },
    emitGitChecking: ({ context }) => {
      context.emitter.emit('git:checking', {});
    },
    emitGitClean: ({ context }) => {
      context.emitter.emit('git:clean', {});
    },
    emitGitDirty: ({ context }) => {
      context.emitter.emit('git:dirty', { files: context.gitDirtyFiles });
    },
    emitGitConfirmed: ({ context }) => {
      context.emitter.emit('git:dirty:confirmed', {});
    },
    emitGitCancelled: ({ context }) => {
      context.emitter.emit('git:dirty:cancelled', {});
    },
    emitCredentialsGathering: ({ context }) => {
      const requiresApiKey = ['nextjs', 'tanstack-start', 'react-router'].includes(context.integration ?? '');
      context.emitter.emit('credentials:gathering', { requiresApiKey });
      context.emitter.emit('credentials:request', { requiresApiKey });
    },
    emitCredentialsFound: ({ context }) => {
      context.emitter.emit('credentials:found', {});
    },
    emitEnvDetected: ({ context }) => {
      context.emitter.emit('credentials:env:detected', { files: context.envFilesDetected ?? [] });
    },
    emitEnvScanPrompt: ({ context }) => {
      context.emitter.emit('credentials:env:prompt', { files: context.envFilesDetected ?? [] });
    },
    emitEnvScanning: ({ context }) => {
      context.emitter.emit('credentials:env:scanning', {});
    },
    emitEnvCredentialsFound: ({ context }) => {
      context.emitter.emit('credentials:env:found', { sourcePath: '.env' });
    },
    emitEnvNotFound: ({ context }) => {
      context.emitter.emit('credentials:env:notfound', {});
    },
    emitDeviceAuthStart: ({ context }) => {
      // Event emitted by actor when it has verification URL
    },
    emitDeviceAuthSuccess: ({ context }) => {
      context.emitter.emit('device:success', { email: undefined });
    },
    emitDeviceAuthError: ({ context }) => {
      const message = context.error?.message ?? 'Device authorization failed';
      context.emitter.emit('device:error', { message });
    },
    emitDeviceTimeout: ({ context }) => {
      context.emitter.emit('device:timeout', {});
    },
    emitStagingFetching: ({ context }) => {
      context.emitter.emit('staging:fetching', {});
    },
    emitStagingSuccess: ({ context }) => {
      context.emitter.emit('staging:success', {});
    },
    emitStagingError: ({ context }) => {
      const message = context.error?.message ?? 'Failed to fetch staging credentials';
      context.emitter.emit('staging:error', { message });
    },
    emitConfigStart: ({ context }) => {
      context.emitter.emit('config:start', {});
    },
    emitConfigComplete: ({ context }) => {
      context.emitter.emit('config:complete', {});
    },
    emitAgentStart: ({ context }) => {
      context.emitter.emit('agent:start', {});
    },
    emitAgentSuccess: ({ context }, params: { summary?: string }) => {
      context.emitter.emit('agent:success', { summary: params.summary });
      context.emitter.emit('complete', { success: true, summary: params.summary });
    },
    emitAgentFailure: ({ context }) => {
      const message = context.error?.message ?? 'Agent execution failed';
      const stack = context.error?.stack;
      context.emitter.emit('agent:failure', { message, stack });
      context.emitter.emit('complete', { success: false, summary: message });
    },
    assignDetectionResult: assign({
      integration: ({ event }) => {
        const doneEvent = event as unknown as { output: DetectionOutput };
        return doneEvent.output?.integration;
      },
    }),
    assignGitResult: assign({
      gitIsClean: ({ event }) => {
        const doneEvent = event as unknown as { output: GitCheckOutput };
        return doneEvent.output?.isClean ?? true;
      },
      gitDirtyFiles: ({ event }) => {
        const doneEvent = event as unknown as { output: GitCheckOutput };
        return doneEvent.output?.files ?? [];
      },
    }),

    assignCredentials: assign({
      credentials: ({ event }) => {
        if (event.type === 'CREDENTIALS_SUBMITTED') {
          return { apiKey: event.apiKey, clientId: event.clientId };
        }
        return undefined;
      },
    }),

    assignError: assign({
      error: ({ event }) => {
        if ('error' in event && event.error instanceof Error) {
          return event.error;
        }
        if ('error' in event && typeof event.error === 'object' && event.error !== null) {
          return new Error(String((event.error as { message?: string }).message ?? event.error));
        }
        return new Error('Unknown error');
      },
    }),

    emitCancelled: ({ context }) => {
      context.emitter.emit('complete', { success: false, summary: 'Wizard cancelled by user' });
    },
    emitError: ({ context }) => {
      const message = context.error?.message ?? 'An unexpected error occurred';
      context.emitter.emit('error', { message, stack: context.error?.stack });
      context.emitter.emit('complete', { success: false, summary: message });
    },
  },

  guards: {
    shouldSkipAuth: ({ context }) => context.options.skipAuth === true,
    gitIsClean: ({ context }) => context.gitIsClean === true,
    hasCredentials: ({ context }) => context.options.apiKey !== undefined && context.options.clientId !== undefined,
    hasIntegration: ({ context }) => context.integration !== undefined,
  },

  actors: {
    checkAuthentication: fromPromise<boolean, { options: WizardOptions }>(async () => {
      throw new Error('checkAuthentication not implemented - provide via machine.provide()');
    }),
    detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async () => {
      throw new Error('detectIntegration not implemented - provide via machine.provide()');
    }),
    checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => {
      throw new Error('checkGitStatus not implemented - provide via machine.provide()');
    }),
    configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async () => {
      throw new Error('configureEnvironment not implemented - provide via machine.provide()');
    }),
    runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => {
      throw new Error('runAgent not implemented - provide via machine.provide()');
    }),
    // Credential discovery actors
    detectEnvFiles: fromPromise<EnvFileInfo, { installDir: string }>(async () => {
      throw new Error('detectEnvFiles not implemented - provide via machine.provide()');
    }),
    scanEnvFiles: fromPromise<DiscoveryResult, { installDir: string }>(async () => {
      throw new Error('scanEnvFiles not implemented - provide via machine.provide()');
    }),
    checkStoredAuth: fromPromise<boolean, void>(async () => {
      throw new Error('checkStoredAuth not implemented - provide via machine.provide()');
    }),
    runDeviceAuth: fromPromise<
      { result: DeviceAuthResult; deviceAuth: DeviceAuthResponse },
      { emitter: WizardMachineContext['emitter'] }
    >(async () => {
      throw new Error('runDeviceAuth not implemented - provide via machine.provide()');
    }),
    fetchStagingCredentials: fromPromise<StagingCredentials, void>(async () => {
      throw new Error('fetchStagingCredentials not implemented - provide via machine.provide()');
    }),
  },
}).createMachine({
  id: 'wizard',
  initial: 'idle',

  context: ({ input }) => ({
    emitter: input.emitter,
    options: input.options,
    integration: input.options.integration,
    credentials:
      input.options.apiKey && input.options.clientId
        ? { apiKey: input.options.apiKey, clientId: input.options.clientId }
        : undefined,
    gitIsClean: true,
    gitDirtyFiles: [],
    error: undefined,
  }),

  // Global event handlers - CANCEL can be sent from any state
  on: {
    CANCEL: {
      target: '.cancelled',
    },
  },

  states: {
    idle: {
      on: {
        START: [
          {
            target: 'preparing',
            guard: 'shouldSkipAuth',
            actions: { type: 'emitStateEnter', params: { state: 'preparing' } },
          },
          {
            target: 'authenticating',
            actions: { type: 'emitStateEnter', params: { state: 'authenticating' } },
          },
        ],
      },
    },

    authenticating: {
      entry: ['emitAuthChecking'],
      invoke: {
        id: 'checkAuthentication',
        src: 'checkAuthentication',
        input: ({ context }) => ({ options: context.options }),
        onDone: {
          target: 'preparing',
          actions: [
            'emitAuthSuccess',
            { type: 'emitStateExit', params: { state: 'authenticating' } },
            { type: 'emitStateEnter', params: { state: 'preparing' } },
          ],
        },
        onError: {
          target: 'error',
          actions: ['assignError', 'emitAuthFailure', { type: 'emitStateExit', params: { state: 'authenticating' } }],
        },
      },
    },

    preparing: {
      type: 'parallel',
      states: {
        detection: {
          initial: 'running',
          states: {
            running: {
              entry: ['emitDetectionStart'],
              invoke: {
                id: 'detectIntegration',
                src: 'detectIntegration',
                input: ({ context }) => ({ options: context.options }),
                onDone: {
                  target: 'done',
                  actions: ['assignDetectionResult', 'emitDetectionComplete'],
                },
                onError: {
                  // Detection failure is non-fatal - user can select manually
                  target: 'done',
                  actions: ['emitDetectionComplete'],
                },
              },
            },
            done: {
              type: 'final',
            },
          },
        },
        gitCheck: {
          initial: 'running',
          states: {
            running: {
              entry: ['emitGitChecking'],
              invoke: {
                id: 'checkGitStatus',
                src: 'checkGitStatus',
                input: ({ context }) => ({ installDir: context.options.installDir }),
                onDone: {
                  target: 'evaluating',
                  actions: ['assignGitResult'],
                },
                onError: {
                  // Git check failure is non-fatal - treat as clean
                  target: 'done',
                },
              },
            },
            evaluating: {
              always: [
                {
                  target: 'done',
                  guard: 'gitIsClean',
                  actions: ['emitGitClean'],
                },
                {
                  target: 'awaitingConfirmation',
                  actions: ['emitGitDirty'],
                },
              ],
            },
            awaitingConfirmation: {
              on: {
                GIT_CONFIRMED: {
                  target: 'done',
                  actions: ['emitGitConfirmed'],
                },
                GIT_CANCELLED: {
                  target: '#wizard.cancelled',
                  actions: ['emitGitCancelled'],
                },
              },
            },
            done: {
              type: 'final',
            },
          },
        },
      },
      onDone: [
        {
          target: 'gatheringCredentials',
          guard: 'hasIntegration',
          actions: { type: 'emitStateExit', params: { state: 'preparing' } },
        },
        {
          target: 'error',
          actions: [
            assign({ error: () => new Error('Could not detect framework integration') }),
            { type: 'emitStateExit', params: { state: 'preparing' } },
          ],
        },
      ],
    },

    gatheringCredentials: {
      entry: [{ type: 'emitStateEnter', params: { state: 'gatheringCredentials' } }],
      initial: 'checkingCliFlags',
      states: {
        // Step 1: Check CLI flags (highest priority)
        checkingCliFlags: {
          always: [
            {
              target: '#wizard.configuring',
              guard: 'hasCredentials',
              actions: [
                assign({ credentialSource: () => 'cli' as CredentialSource }),
                'emitCredentialsFound',
                { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
              ],
            },
            { target: 'detectingEnvFiles' },
          ],
        },

        // Step 2: Check if env files exist (don't read yet)
        detectingEnvFiles: {
          invoke: {
            id: 'detectEnvFiles',
            src: 'detectEnvFiles',
            input: ({ context }) => ({ installDir: context.options.installDir }),
            onDone: [
              {
                target: 'promptingEnvScan',
                guard: ({ event }) => {
                  const output = event.output as EnvFileInfo;
                  return output.exists;
                },
                actions: [
                  assign({
                    envFilesDetected: ({ event }) => {
                      const output = event.output as EnvFileInfo;
                      return output.files;
                    },
                  }),
                  'emitEnvDetected',
                ],
              },
              { target: 'checkingStoredAuth' },
            ],
            onError: {
              target: 'checkingStoredAuth', // Non-fatal, continue
            },
          },
        },

        // Step 3: Ask user for consent to scan env files
        promptingEnvScan: {
          entry: ['emitEnvScanPrompt'],
          on: {
            ENV_SCAN_APPROVED: {
              target: 'scanningEnvFiles',
              actions: assign({ envScanConsent: () => true }),
            },
            ENV_SCAN_DECLINED: {
              target: 'checkingStoredAuth',
              actions: assign({ envScanConsent: () => false }),
            },
            CANCEL: {
              target: '#wizard.cancelled',
              actions: { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
            },
          },
        },

        // Step 4: Scan env files for credentials (with consent)
        scanningEnvFiles: {
          entry: ['emitEnvScanning'],
          invoke: {
            id: 'scanEnvFiles',
            src: 'scanEnvFiles',
            input: ({ context }) => ({ installDir: context.options.installDir }),
            onDone: [
              {
                target: '#wizard.configuring',
                guard: ({ event }) => {
                  const result = event.output as DiscoveryResult;
                  return result.found && !!result.clientId;
                },
                actions: [
                  assign({
                    credentials: ({ event }) => {
                      const result = event.output as DiscoveryResult;
                      return { clientId: result.clientId!, apiKey: result.apiKey };
                    },
                    credentialSource: () => 'env' as CredentialSource,
                  }),
                  'emitEnvCredentialsFound',
                  { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
                ],
              },
              {
                target: 'checkingStoredAuth',
                actions: ['emitEnvNotFound'],
              },
            ],
            onError: {
              target: 'checkingStoredAuth',
            },
          },
        },

        // Step 5: Check for stored auth token
        checkingStoredAuth: {
          invoke: {
            id: 'checkStoredAuth',
            src: 'checkStoredAuth',
            onDone: [
              {
                target: 'fetchingStagingCredentials',
                guard: ({ event }) => event.output === true,
              },
              { target: 'runningDeviceAuth' },
            ],
            onError: {
              target: 'runningDeviceAuth',
            },
          },
        },

        // Step 6: Run device authorization flow
        runningDeviceAuth: {
          entry: ['emitDeviceAuthStart'],
          invoke: {
            id: 'runDeviceAuth',
            src: 'runDeviceAuth',
            input: ({ context }) => ({ emitter: context.emitter }),
            onDone: {
              target: 'fetchingStagingCredentials',
              actions: [
                'emitDeviceAuthSuccess',
                assign({
                  deviceAuth: ({ event }) => {
                    const output = event.output as { result: DeviceAuthResult; deviceAuth: DeviceAuthResponse };
                    return {
                      verificationUri: output.deviceAuth.verification_uri,
                      verificationUriComplete: output.deviceAuth.verification_uri_complete,
                      userCode: output.deviceAuth.user_code,
                    };
                  },
                }),
              ],
            },
            onError: {
              target: 'promptingManual',
              actions: ['assignError', 'emitDeviceAuthError'],
            },
          },
        },

        // Step 7: Fetch staging credentials from API
        fetchingStagingCredentials: {
          entry: ['emitStagingFetching'],
          invoke: {
            id: 'fetchStagingCredentials',
            src: 'fetchStagingCredentials',
            onDone: {
              target: '#wizard.configuring',
              actions: [
                assign({
                  credentials: ({ event }) => {
                    const staging = event.output as StagingCredentials;
                    return { clientId: staging.clientId, apiKey: staging.apiKey };
                  },
                  credentialSource: ({ context }) =>
                    context.deviceAuth ? ('device' as CredentialSource) : ('stored' as CredentialSource),
                }),
                'emitStagingSuccess',
                { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
              ],
            },
            onError: {
              target: 'promptingManual',
              actions: ['assignError', 'emitStagingError'],
            },
          },
        },

        // Step 8: Manual fallback
        promptingManual: {
          entry: ['emitCredentialsGathering'],
          on: {
            CREDENTIALS_SUBMITTED: {
              target: '#wizard.configuring',
              actions: [
                'assignCredentials',
                assign({ credentialSource: () => 'manual' as CredentialSource }),
                { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
              ],
            },
            RETRY_AUTH: {
              target: 'runningDeviceAuth',
            },
            CANCEL: {
              target: '#wizard.cancelled',
              actions: { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
            },
          },
        },
      },
    },

    configuring: {
      entry: [{ type: 'emitStateEnter', params: { state: 'configuring' } }, 'emitConfigStart'],
      invoke: {
        id: 'configureEnvironment',
        src: 'configureEnvironment',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'runningAgent',
          actions: ['emitConfigComplete', { type: 'emitStateExit', params: { state: 'configuring' } }],
        },
        onError: {
          target: 'error',
          actions: ['assignError', { type: 'emitStateExit', params: { state: 'configuring' } }],
        },
      },
    },

    runningAgent: {
      entry: [{ type: 'emitStateEnter', params: { state: 'runningAgent' } }, 'emitAgentStart'],
      invoke: {
        id: 'runAgent',
        src: 'runAgent',
        input: ({ context }) => ({ context }),
        onDone: {
          target: 'complete',
          actions: [
            ({ context, event }) => {
              const output = event.output as AgentOutput;
              if (output.success) {
                context.emitter.emit('agent:success', { summary: output.summary });
                context.emitter.emit('complete', { success: true, summary: output.summary });
              } else {
                context.emitter.emit('agent:failure', {
                  message: output.error?.message ?? 'Agent failed',
                });
                context.emitter.emit('complete', {
                  success: false,
                  summary: output.error?.message,
                });
              }
            },
            { type: 'emitStateExit', params: { state: 'runningAgent' } },
          ],
        },
        onError: {
          target: 'error',
          actions: ['assignError', 'emitAgentFailure', { type: 'emitStateExit', params: { state: 'runningAgent' } }],
        },
      },
    },

    complete: {
      type: 'final',
      entry: { type: 'emitStateEnter', params: { state: 'complete' } },
    },

    cancelled: {
      type: 'final',
      entry: [{ type: 'emitStateEnter', params: { state: 'cancelled' } }, 'emitCancelled'],
    },

    error: {
      type: 'final',
      entry: [{ type: 'emitStateEnter', params: { state: 'error' } }, 'emitError'],
    },
  },
});

export type WizardMachine = typeof wizardMachine;
export type WizardActor = ActorRefFrom<typeof wizardMachine>;
