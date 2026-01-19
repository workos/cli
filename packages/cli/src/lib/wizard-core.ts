import { setup, assign, fromPromise, type ActorRefFrom } from 'xstate';
import type {
  WizardMachineContext,
  WizardMachineInput,
  WizardMachineEvent,
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
} from './wizard-core.types.js';
import type { WizardOptions } from '../utils/types.js';

/**
 * Creates the wizard state machine using XState v5 setup() API.
 *
 * The machine orchestrates:
 * 1. Authentication check
 * 2. Parallel: framework detection + git status check
 * 3. Credentials gathering (if needed)
 * 4. Environment configuration
 * 5. Agent execution
 *
 * All UI communication happens through the emitter - the machine
 * never directly renders anything.
 */
export const wizardMachine = setup({
  types: {
    context: {} as WizardMachineContext,
    input: {} as WizardMachineInput,
    events: {} as WizardMachineEvent,
  },

  actions: {
    // ===== State lifecycle actions =====
    emitStateEnter: ({ context }, params: { state: string }) => {
      context.emitter.emit('state:enter', { state: params.state });
    },
    emitStateExit: ({ context }, params: { state: string }) => {
      context.emitter.emit('state:exit', { state: params.state });
    },

    // ===== Auth actions =====
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

    // ===== Detection actions =====
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

    // ===== Git actions =====
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

    // ===== Credentials actions =====
    emitCredentialsGathering: ({ context }) => {
      // Determine if API key is required based on integration
      const requiresApiKey = ['nextjs', 'tanstack-start', 'react-router'].includes(context.integration ?? '');
      context.emitter.emit('credentials:gathering', { requiresApiKey });
      context.emitter.emit('credentials:request', { requiresApiKey });
    },

    // ===== Config actions =====
    emitConfigStart: ({ context }) => {
      context.emitter.emit('config:start', {});
    },
    emitConfigComplete: ({ context }) => {
      context.emitter.emit('config:complete', {});
    },

    // ===== Agent actions =====
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

    // ===== Context assignment actions =====
    assignDetectionResult: assign({
      integration: ({ event }) => {
        // XState internal done event has output property
        const doneEvent = event as unknown as { output: DetectionOutput };
        return doneEvent.output?.integration;
      },
    }),

    assignGitResult: assign({
      gitIsClean: ({ event }) => {
        // XState internal done event has output property
        const doneEvent = event as unknown as { output: GitCheckOutput };
        return doneEvent.output?.isClean ?? true;
      },
      gitDirtyFiles: ({ event }) => {
        // XState internal done event has output property
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

    // ===== Completion actions =====
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
    /** Check if user wants to skip auth (--skip-auth flag) */
    shouldSkipAuth: ({ context }) => context.options.skipAuth === true,

    /** Check if git is clean after git check completes */
    gitIsClean: ({ context }) => context.gitIsClean === true,

    /** Check if we have credentials already (from CLI args or env) */
    hasCredentials: ({ context }) => context.options.apiKey !== undefined && context.options.clientId !== undefined,

    /** Check if detection found an integration */
    hasIntegration: ({ context }) => context.integration !== undefined,
  },

  actors: {
    /**
     * Check if user is authenticated.
     * Returns true if auth is valid, throws if auth fails.
     */
    checkAuthentication: fromPromise<boolean, { options: WizardOptions }>(async () => {
      // Implementation injected at runtime via machine.provide()
      // This is a placeholder that will be replaced
      throw new Error('checkAuthentication not implemented - provide via machine.provide()');
    }),

    /**
     * Detect the framework integration from the project.
     */
    detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async () => {
      throw new Error('detectIntegration not implemented - provide via machine.provide()');
    }),

    /**
     * Check git status for uncommitted changes.
     */
    checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => {
      throw new Error('checkGitStatus not implemented - provide via machine.provide()');
    }),

    /**
     * Configure environment (write .env.local, auto-configure WorkOS).
     */
    configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async () => {
      throw new Error('configureEnvironment not implemented - provide via machine.provide()');
    }),

    /**
     * Run the AI agent to perform the integration.
     */
    runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => {
      throw new Error('runAgent not implemented - provide via machine.provide()');
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

  states: {
    /**
     * Initial idle state. Waits for START event to begin.
     */
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

    /**
     * Checking/performing authentication.
     */
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

    /**
     * Parallel state: detect framework AND check git status concurrently.
     * Completes when BOTH child states reach their final states.
     */
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
      // This onDone fires when BOTH parallel regions reach their final states
      onDone: [
        {
          target: 'gatheringCredentials',
          guard: 'hasIntegration',
          actions: { type: 'emitStateExit', params: { state: 'preparing' } },
        },
        {
          // No integration detected and couldn't detect - this is an error
          target: 'error',
          actions: [
            assign({ error: () => new Error('Could not detect framework integration') }),
            { type: 'emitStateExit', params: { state: 'preparing' } },
          ],
        },
      ],
    },

    /**
     * Gathering WorkOS credentials from user (if not already provided).
     */
    gatheringCredentials: {
      entry: [{ type: 'emitStateEnter', params: { state: 'gatheringCredentials' } }, 'emitCredentialsGathering'],
      always: [
        {
          target: 'configuring',
          guard: 'hasCredentials',
          actions: { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
        },
      ],
      on: {
        CREDENTIALS_SUBMITTED: {
          target: 'configuring',
          actions: ['assignCredentials', { type: 'emitStateExit', params: { state: 'gatheringCredentials' } }],
        },
        CANCEL: {
          target: 'cancelled',
          actions: { type: 'emitStateExit', params: { state: 'gatheringCredentials' } },
        },
      },
    },

    /**
     * Configuring environment (writing .env.local, auto-configuring WorkOS).
     */
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

    /**
     * Running the AI agent to perform the actual integration.
     */
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

    /**
     * Wizard completed successfully.
     */
    complete: {
      type: 'final',
      entry: { type: 'emitStateEnter', params: { state: 'complete' } },
    },

    /**
     * Wizard was cancelled by user.
     */
    cancelled: {
      type: 'final',
      entry: [{ type: 'emitStateEnter', params: { state: 'cancelled' } }, 'emitCancelled'],
    },

    /**
     * Wizard encountered an error.
     */
    error: {
      type: 'final',
      entry: [{ type: 'emitStateEnter', params: { state: 'error' } }, 'emitError'],
    },
  },
});

// Export the machine type for use in actors
export type WizardMachine = typeof wizardMachine;
export type WizardActor = ActorRefFrom<typeof wizardMachine>;
