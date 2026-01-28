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
  BranchCheckOutput,
} from './wizard-core.types.js';
import type { WizardOptions } from '../utils/types.js';
import type { DeviceAuthResult, DeviceAuthResponse } from './device-auth.js';
import type { StagingCredentials } from './staging-api.js';
import { getManualPrInstructions } from './post-install.js';
import { hasGhCli } from '../utils/git-utils.js';

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
    emitBranchChecking: ({ context }) => {
      context.emitter.emit('branch:checking', {});
    },
    emitBranchProtected: ({ context }) => {
      if (context.currentBranch) {
        context.emitter.emit('branch:protected', { branch: context.currentBranch });
        context.emitter.emit('branch:prompt', { branch: context.currentBranch });
      }
    },
    emitBranchCreated: ({ context }, params: { branch: string }) => {
      context.emitter.emit('branch:created', { branch: params.branch });
    },
    emitBranchCreateFailed: ({ context }) => {
      const message = context.error?.message ?? 'Failed to create branch';
      context.emitter.emit('branch:create:failed', { error: message });
    },
    assignBranchResult: assign({
      currentBranch: ({ event }) => {
        const doneEvent = event as unknown as { output: BranchCheckOutput };
        return doneEvent.output?.branch ?? undefined;
      },
      isProtectedBranch: ({ event }) => {
        const doneEvent = event as unknown as { output: BranchCheckOutput };
        return doneEvent.output?.isProtected ?? false;
      },
    }),
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
      context.emitter.emit('credentials:env:found', { sourcePath: context.envCredentialPath ?? '.env' });
    },
    emitEnvNotFound: ({ context }) => {
      context.emitter.emit('credentials:env:notfound', {});
    },
    emitDeviceAuthStart: () => {
      // Emitted by actor when it has verification URL
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
    // Post-install actions
    assignChangedFiles: assign({
      changedFiles: ({ event }) => {
        const doneEvent = event as unknown as { output: { hasChanges: boolean; files: string[] } };
        return doneEvent.output?.files ?? [];
      },
    }),
    emitChangesDetected: ({ context }) => {
      context.emitter.emit('postinstall:changes', { files: context.changedFiles ?? [] });
    },
    emitNoChanges: ({ context }) => {
      context.emitter.emit('postinstall:nochanges', {});
    },
    emitCommitPrompt: ({ context }) => {
      context.emitter.emit('postinstall:commit:prompt', {});
    },
    emitGeneratingCommitMessage: ({ context }) => {
      context.emitter.emit('postinstall:commit:generating', {});
    },
    assignCommitMessage: assign({
      commitMessage: ({ event }) => {
        const doneEvent = event as unknown as { output: string };
        return doneEvent.output;
      },
    }),
    assignDefaultCommitMessage: assign({
      commitMessage: ({ context }) => `feat: add WorkOS AuthKit integration for ${context.integration ?? 'project'}`,
    }),
    emitCommitting: ({ context }) => {
      context.emitter.emit('postinstall:commit:committing', { message: context.commitMessage ?? '' });
    },
    emitCommitSuccess: ({ context }) => {
      context.emitter.emit('postinstall:commit:success', { message: context.commitMessage ?? '' });
    },
    emitCommitFailed: ({ context }) => {
      const message = context.error?.message ?? 'Commit failed';
      context.emitter.emit('postinstall:commit:failed', { error: message });
    },
    emitPrPrompt: ({ context }) => {
      context.emitter.emit('postinstall:pr:prompt', {});
    },
    emitGeneratingPrDescription: ({ context }) => {
      context.emitter.emit('postinstall:pr:generating', {});
    },
    assignPrDescription: assign({
      prDescription: ({ event }) => {
        const doneEvent = event as unknown as { output: string };
        return doneEvent.output;
      },
    }),
    assignDefaultPrDescription: assign({
      prDescription: ({ context }) => {
        const files = context.changedFiles ?? [];
        return `## Summary\nAdded WorkOS AuthKit integration for ${context.integration ?? 'project'}.\n\n## Changes\n${files.map((f) => `- ${f}`).join('\n')}\n\n## Documentation\nhttps://workos.com/docs/user-management`;
      },
    }),
    emitPushing: ({ context }) => {
      context.emitter.emit('postinstall:pr:pushing', {});
    },
    emitPushFailed: ({ context }) => {
      const message = context.error?.message ?? 'Push failed';
      context.emitter.emit('postinstall:push:failed', { error: message });
    },
    emitCreatingPr: ({ context }) => {
      context.emitter.emit('postinstall:pr:creating', {});
    },
    assignPrUrl: assign({
      prUrl: ({ event }) => {
        const doneEvent = event as unknown as { output: string };
        return doneEvent.output;
      },
    }),
    emitPrCreated: ({ context }) => {
      context.emitter.emit('postinstall:pr:success', { url: context.prUrl ?? '' });
    },
    emitPrFailed: ({ context }) => {
      const message = context.error?.message ?? 'PR creation failed';
      context.emitter.emit('postinstall:pr:failed', { error: message });
    },
    emitManualInstructions: ({ context }) => {
      const branch = context.currentBranch ?? 'HEAD';
      const instructions = getManualPrInstructions(branch);
      context.emitter.emit('postinstall:manual', { instructions });
    },
    emitComplete: ({ context }) => {
      const summary = context.agentSummary ?? 'WorkOS AuthKit installed successfully!';
      context.emitter.emit('complete', { success: true, summary });
    },
  },

  guards: {
    shouldSkipAuth: ({ context }) => context.options.skipAuth === true,
    gitIsClean: ({ context }) => context.gitIsClean === true,
    hasCredentials: ({ context }) => context.options.apiKey !== undefined && context.options.clientId !== undefined,
    hasIntegration: ({ context }) => context.integration !== undefined,
    shouldSkipPostInstall: ({ context }) => context.options.noCommit === true,
    hasGhCli: () => hasGhCli(),
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
    // Branch check actors
    checkBranch: fromPromise<BranchCheckOutput, void>(async () => {
      throw new Error('checkBranch not implemented - provide via machine.provide()');
    }),
    createBranch: fromPromise<{ branch: string }, { name: string; fallbackName: string }>(async () => {
      throw new Error('createBranch not implemented - provide via machine.provide()');
    }),
    // Post-install actors
    detectChanges: fromPromise<{ hasChanges: boolean; files: string[] }, void>(async () => {
      throw new Error('detectChanges not implemented - provide via machine.provide()');
    }),
    generateCommitMessage: fromPromise<string, { integration: string; files: string[] }>(async () => {
      throw new Error('generateCommitMessage not implemented - provide via machine.provide()');
    }),
    commitChanges: fromPromise<void, { message: string; cwd: string }>(async () => {
      throw new Error('commitChanges not implemented - provide via machine.provide()');
    }),
    generatePrDescription: fromPromise<string, { integration: string; files: string[]; commitMessage: string }>(
      async () => {
        throw new Error('generatePrDescription not implemented - provide via machine.provide()');
      },
    ),
    pushBranch: fromPromise<void, { cwd: string }>(async () => {
      throw new Error('pushBranch not implemented - provide via machine.provide()');
    }),
    createPr: fromPromise<string, { title: string; body: string; cwd: string }>(async () => {
      throw new Error('createPr not implemented - provide via machine.provide()');
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
        branchCheck: {
          initial: 'running',
          states: {
            running: {
              entry: ['emitBranchChecking'],
              invoke: {
                id: 'checkBranch',
                src: 'checkBranch',
                onDone: [
                  {
                    target: 'awaitingConfirmation',
                    guard: ({ event }) => (event.output as BranchCheckOutput).isProtected,
                    actions: ['assignBranchResult', 'emitBranchProtected'],
                  },
                  {
                    target: 'done',
                    actions: ['assignBranchResult'],
                  },
                ],
                onError: {
                  // Branch check failure is non-fatal
                  target: 'done',
                },
              },
            },
            awaitingConfirmation: {
              on: {
                BRANCH_CREATE: {
                  target: 'creating',
                },
                BRANCH_CONTINUE: {
                  target: 'done',
                },
                BRANCH_CANCEL: {
                  target: '#wizard.cancelled',
                },
              },
            },
            creating: {
              invoke: {
                id: 'createBranch',
                src: 'createBranch',
                input: () => ({
                  name: 'feat/add-workos-authkit',
                  fallbackName: `feat/add-workos-authkit-${Date.now()}`,
                }),
                onDone: {
                  target: 'done',
                  actions: [
                    {
                      type: 'emitBranchCreated',
                      params: ({ event }) => ({ branch: (event.output as { branch: string }).branch }),
                    },
                  ],
                },
                onError: {
                  // Branch creation failure is non-fatal
                  target: 'done',
                  actions: ['assignError', 'emitBranchCreateFailed'],
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
                    envCredentialPath: ({ event }) => (event.output as DiscoveryResult).sourcePath,
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
        onDone: [
          {
            target: 'error',
            guard: ({ event }) => {
              const output = event.output as AgentOutput;
              return !output.success;
            },
            actions: [
              ({ context, event }) => {
                const output = event.output as AgentOutput;
                context.emitter.emit('agent:failure', {
                  message: output.error?.message ?? 'Agent failed',
                });
              },
              assign({
                error: ({ event }) => {
                  const output = event.output as AgentOutput;
                  return output.error ?? new Error('Agent failed');
                },
              }),
              { type: 'emitStateExit', params: { state: 'runningAgent' } },
            ],
          },
          {
            target: 'postInstall',
            actions: [
              assign({
                agentSummary: ({ event }) => {
                  const output = event.output as AgentOutput;
                  return output.summary;
                },
              }),
              ({ context, event }) => {
                const output = event.output as AgentOutput;
                context.emitter.emit('agent:success', { summary: output.summary });
              },
              { type: 'emitStateExit', params: { state: 'runningAgent' } },
            ],
          },
        ],
        onError: {
          target: 'error',
          actions: ['assignError', 'emitAgentFailure', { type: 'emitStateExit', params: { state: 'runningAgent' } }],
        },
      },
    },

    postInstall: {
      initial: 'checking',
      entry: [{ type: 'emitStateEnter', params: { state: 'postInstall' } }],
      states: {
        checking: {
          always: [
            {
              target: '#wizard.complete',
              guard: 'shouldSkipPostInstall',
            },
            { target: 'detectingChanges' },
          ],
        },

        detectingChanges: {
          invoke: {
            id: 'detectChanges',
            src: 'detectChanges',
            onDone: [
              {
                target: 'promptingCommit',
                guard: ({ event }) => (event.output as { hasChanges: boolean; files: string[] }).hasChanges,
                actions: ['assignChangedFiles', 'emitChangesDetected'],
              },
              {
                target: 'done',
                actions: ['emitNoChanges'],
              },
            ],
            onError: { target: 'done' },
          },
        },

        promptingCommit: {
          entry: ['emitCommitPrompt'],
          on: {
            COMMIT_APPROVED: { target: 'generatingCommitMessage' },
            COMMIT_DECLINED: { target: 'done' },
            CANCEL: { target: '#wizard.cancelled' },
          },
        },

        generatingCommitMessage: {
          entry: ['emitGeneratingCommitMessage'],
          invoke: {
            id: 'generateCommitMessage',
            src: 'generateCommitMessage',
            input: ({ context }) => ({
              integration: context.integration ?? 'project',
              files: context.changedFiles ?? [],
            }),
            onDone: {
              target: 'committing',
              actions: ['assignCommitMessage'],
            },
            onError: {
              target: 'committing',
              actions: ['assignDefaultCommitMessage'],
            },
          },
        },

        committing: {
          entry: ['emitCommitting'],
          invoke: {
            id: 'commitChanges',
            src: 'commitChanges',
            input: ({ context }) => ({
              message: context.commitMessage ?? '',
              cwd: context.options.installDir,
            }),
            onDone: {
              target: 'checkingGhCli',
              actions: ['emitCommitSuccess'],
            },
            onError: {
              target: 'done',
              actions: ['assignError', 'emitCommitFailed'],
            },
          },
        },

        checkingGhCli: {
          always: [
            {
              target: 'promptingPr',
              guard: 'hasGhCli',
            },
            {
              target: 'showingManualInstructions',
            },
          ],
        },

        promptingPr: {
          entry: ['emitPrPrompt'],
          on: {
            PR_APPROVED: { target: 'generatingPrDescription' },
            PR_DECLINED: { target: 'done' },
            CANCEL: { target: '#wizard.cancelled' },
          },
        },

        generatingPrDescription: {
          entry: ['emitGeneratingPrDescription'],
          invoke: {
            id: 'generatePrDescription',
            src: 'generatePrDescription',
            input: ({ context }) => ({
              integration: context.integration ?? 'project',
              files: context.changedFiles ?? [],
              commitMessage: context.commitMessage ?? '',
            }),
            onDone: {
              target: 'pushing',
              actions: ['assignPrDescription'],
            },
            onError: {
              target: 'pushing',
              actions: ['assignDefaultPrDescription'],
            },
          },
        },

        pushing: {
          entry: ['emitPushing'],
          invoke: {
            id: 'pushBranch',
            src: 'pushBranch',
            input: ({ context }) => ({ cwd: context.options.installDir }),
            onDone: { target: 'creatingPr' },
            onError: {
              target: 'showingManualInstructions',
              actions: ['assignError', 'emitPushFailed'],
            },
          },
        },

        creatingPr: {
          entry: ['emitCreatingPr'],
          invoke: {
            id: 'createPr',
            src: 'createPr',
            input: ({ context }) => ({
              title: context.commitMessage ?? '',
              body: context.prDescription ?? '',
              cwd: context.options.installDir,
            }),
            onDone: {
              target: 'done',
              actions: ['assignPrUrl', 'emitPrCreated'],
            },
            onError: {
              target: 'done',
              actions: ['assignError', 'emitPrFailed'],
            },
          },
        },

        showingManualInstructions: {
          entry: ['emitManualInstructions'],
          always: { target: 'done' },
        },

        done: {
          type: 'final',
        },
      },
      onDone: {
        target: 'complete',
      },
    },

    complete: {
      type: 'final',
      entry: [
        { type: 'emitStateEnter', params: { state: 'complete' } },
        'emitComplete',
      ],
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
