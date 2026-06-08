import { describe, it, expect } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { installerMachine } from './installer-core.js';
import { createInstallerEventEmitter } from './events.js';
import type { InstallerOptions } from '../utils/types.js';
import type {
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
  InstallerMachineContext,
  BranchCheckOutput,
  WorkspaceCheckOutput,
} from './installer-core.types.js';
import type { EnvFileInfo } from './credential-discovery.js';
import type { StagingCredentials } from './staging-api.js';

// Shared mock actors for reuse across tests
const baseMockActors = {
  checkAuthentication: fromPromise<boolean, { options: InstallerOptions }>(async () => true),
  // Default: not an empty dir, so the scaffold state falls straight through to preparing.
  checkWorkspace: fromPromise<WorkspaceCheckOutput, { options: InstallerOptions }>(async () => ({
    scaffoldable: false,
    packageManager: 'npm',
    autoScaffold: false,
  })),
  runScaffold: fromPromise<void, { context: InstallerMachineContext }>(async () => {}),
  detectIntegration: fromPromise<DetectionOutput, { options: InstallerOptions }>(async () => ({
    integration: 'nextjs',
  })),
  checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
    isClean: true,
    files: [],
  })),
  checkBranch: fromPromise<BranchCheckOutput, void>(async () => ({
    branch: 'main',
    isProtected: false,
  })),
  createBranch: fromPromise<{ branch: string }, { name: string; fallbackName: string }>(async ({ input }) => ({
    branch: input.name,
  })),
  configureEnvironment: fromPromise<void, { context: InstallerMachineContext }>(async () => {}),
  runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
    success: true,
    summary: 'Done!',
  })),
};

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Parallel-state actors that resolve slowly, so the `preparing` parallel snapshot
// (detection/gitCheck/branchCheck all "running") is observable after a short wait.
// Needed because the async scaffold gate now precedes `preparing`.
const slowPreparingActors = {
  detectIntegration: fromPromise<DetectionOutput, { options: InstallerOptions }>(async () => {
    await delay(200);
    return { integration: 'nextjs' };
  }),
  checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => {
    await delay(200);
    return { isClean: true, files: [] };
  }),
  checkBranch: fromPromise<BranchCheckOutput, void>(async () => {
    await delay(200);
    return { branch: 'main', isProtected: false };
  }),
};

function createTestActor(overrides?: Partial<InstallerOptions>, actorOverrides?: Partial<typeof baseMockActors>) {
  const emitter = createInstallerEventEmitter();
  const options: InstallerOptions = {
    debug: false,
    forceInstall: false,
    installDir: '/test/project',
    default: false,
    local: true,
    ci: false,
    skipAuth: false,
    dashboard: false,
    emitter,
    ...overrides,
  };

  // Provide mock implementations for actors
  const machine = installerMachine.provide({
    actors: { ...baseMockActors, ...actorOverrides },
  });

  const actor = createActor(machine, {
    input: { emitter, options },
  });

  return { actor, emitter, options };
}

describe('InstallerCore State Machine', () => {
  describe('initial state', () => {
    it('starts in idle state', () => {
      const { actor } = createTestActor();
      actor.start();
      expect(actor.getSnapshot().value).toBe('idle');
      actor.stop();
    });
  });

  describe('authentication', () => {
    it('transitions from idle to authenticating on START', () => {
      const { actor } = createTestActor();
      actor.start();
      actor.send({ type: 'START' });
      expect(actor.getSnapshot().value).toBe('authenticating');
      actor.stop();
    });

    it('skips auth when skipAuth option is true', async () => {
      const { actor } = createTestActor({ skipAuth: true }, slowPreparingActors);
      actor.start();
      actor.send({ type: 'START' });
      // The scaffold workspace-check runs first (async, instant); once it resolves
      // not-scaffoldable, the machine lands in preparing (no authenticating state).
      await delay(40);
      expect(actor.getSnapshot().value).toEqual({
        preparing: { detection: 'running', gitCheck: 'running', branchCheck: 'running' },
      });
      actor.stop();
    });
  });

  describe('parallel states', () => {
    it('runs detection, git check, and branch check in parallel', async () => {
      const { actor } = createTestActor({ skipAuth: true }, slowPreparingActors);
      actor.start();
      actor.send({ type: 'START' });
      await delay(40);

      // All three should be running in parallel
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toEqual({
        preparing: { detection: 'running', gitCheck: 'running', branchCheck: 'running' },
      });
      actor.stop();
    });
  });

  describe('event emissions', () => {
    it('emits auth:checking when entering authenticating', () => {
      const { actor, emitter } = createTestActor();
      const events: string[] = [];
      emitter.on('auth:checking', () => events.push('auth:checking'));

      actor.start();
      actor.send({ type: 'START' });

      expect(events).toContain('auth:checking');
      actor.stop();
    });

    it('emits state:enter for each state transition', async () => {
      const { actor, emitter } = createTestActor({ skipAuth: true });
      const states: string[] = [];
      emitter.on('state:enter', ({ state }) => states.push(state));

      actor.start();
      actor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 50));

      expect(states).toContain('scaffold');
      expect(states).toContain('preparing');
      actor.stop();
    });
  });

  describe('error handling', () => {
    it('transitions to error state on auth failure', async () => {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        default: false,
        local: true,
        ci: false,
        skipAuth: false,
        dashboard: false,
        emitter,
      };

      const errorMachine = installerMachine.provide({
        actors: {
          ...baseMockActors,
          checkAuthentication: fromPromise<boolean, { options: InstallerOptions }>(async () => {
            throw new Error('Auth failed');
          }),
        },
      });

      const errorActor = createActor(errorMachine, {
        input: { emitter, options },
      });

      const errorEvents: string[] = [];
      emitter.on('auth:failure', () => errorEvents.push('auth:failure'));
      // Prevent Node EventEmitter from throwing on 'error' event
      emitter.on('error', () => errorEvents.push('error'));

      errorActor.start();
      errorActor.send({ type: 'START' });

      // Wait for async transition
      await new Promise((r) => setTimeout(r, 50));

      expect(errorActor.getSnapshot().value).toBe('error');
      expect(errorEvents).toContain('auth:failure');
      errorActor.stop();
    });
  });

  describe('git confirmation flow', () => {
    it('waits for confirmation when git is dirty', async () => {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        default: false,
        local: true,
        ci: false,
        skipAuth: true,
        dashboard: false,
        emitter,
      };

      const dirtyMachine = installerMachine.provide({
        actors: {
          ...baseMockActors,
          checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
            isClean: false,
            files: ['file1.ts', 'file2.ts'],
          })),
        },
      });

      const dirtyActor = createActor(dirtyMachine, {
        input: { emitter, options },
      });

      dirtyActor.start();
      dirtyActor.send({ type: 'START' });

      // Wait for parallel states to process
      await new Promise((r) => setTimeout(r, 50));

      // Git check should be awaiting confirmation
      const snapshot = dirtyActor.getSnapshot();
      expect(snapshot.value).toMatchObject({
        preparing: { gitCheck: 'awaitingConfirmation' },
      });

      // Confirm and continue
      dirtyActor.send({ type: 'GIT_CONFIRMED' });

      await new Promise((r) => setTimeout(r, 50));

      // Should proceed past preparing (to gatheringCredentials or configuring)
      const finalSnapshot = dirtyActor.getSnapshot();
      expect(finalSnapshot.value).not.toMatchObject({
        preparing: expect.anything(),
      });
      dirtyActor.stop();
    });

    it('cancels wizard when user declines git confirmation', async () => {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        default: false,
        local: true,
        ci: false,
        skipAuth: true,
        dashboard: false,
        emitter,
      };

      const dirtyMachine = installerMachine.provide({
        actors: {
          ...baseMockActors,
          checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
            isClean: false,
            files: ['file1.ts'],
          })),
        },
      });

      const dirtyActor = createActor(dirtyMachine, {
        input: { emitter, options },
      });

      dirtyActor.start();
      dirtyActor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 50));

      dirtyActor.send({ type: 'GIT_CANCELLED' });
      await new Promise((r) => setTimeout(r, 50));

      expect(dirtyActor.getSnapshot().value).toBe('cancelled');
      dirtyActor.stop();
    });
  });

  describe('full flow', () => {
    it('completes the full wizard flow with provided credentials', async () => {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        default: false,
        local: true,
        ci: false,
        skipAuth: true,
        dashboard: false,
        emitter,
        apiKey: 'sk_test_123',
        clientId: 'client_123',
      };

      const machine = installerMachine.provide({
        actors: {
          ...baseMockActors,
          runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
            success: true,
            summary: 'AuthKit installed successfully!',
          })),
        },
      });

      const actor = createActor(machine, {
        input: { emitter, options },
      });

      const statesEntered: string[] = [];
      emitter.on('state:enter', ({ state }) => statesEntered.push(state));

      let completionResult: { success: boolean; summary?: string } | null = null;
      emitter.on('complete', (result) => {
        completionResult = result;
      });

      actor.start();
      actor.send({ type: 'START' });

      // Wait for full flow
      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(completionResult).toEqual({
        success: true,
        summary: 'AuthKit installed successfully!',
      });
      expect(statesEntered).toContain('complete');
      actor.stop();
    });

    it('handles credentials submission flow', async () => {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        default: false,
        local: true,
        ci: false,
        skipAuth: true,
        dashboard: false,
        emitter,
        // No credentials provided - should wait for CREDENTIALS_SUBMITTED
      };

      const machine = installerMachine.provide({
        actors: baseMockActors,
      });

      const actor = createActor(machine, {
        input: { emitter, options },
      });

      let credentialsRequested = false;
      emitter.on('credentials:request', () => {
        credentialsRequested = true;
      });

      actor.start();
      actor.send({ type: 'START' });

      // Wait for preparing to complete
      await new Promise((r) => setTimeout(r, 100));

      // gatheringCredentials is now a hierarchical state with substates
      const snapshot = actor.getSnapshot();
      expect(snapshot.matches('gatheringCredentials')).toBe(true);
      expect(credentialsRequested).toBe(true);

      // Submit credentials
      actor.send({
        type: 'CREDENTIALS_SUBMITTED',
        apiKey: 'sk_test_456',
        clientId: 'client_456',
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      actor.stop();
    });

    it('skips device auth when checkStoredAuth returns true (unclaimed env)', async () => {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        default: false,
        local: true,
        ci: false,
        skipAuth: true,
        dashboard: false,
        emitter,
        // No CLI credentials — forces credential gathering flow
      };

      let deviceAuthStarted = false;

      const machine = installerMachine.provide({
        actors: {
          ...baseMockActors,
          detectEnvFiles: fromPromise<EnvFileInfo, { installDir: string }>(async () => ({
            found: false,
          })),
          checkStoredAuth: fromPromise<boolean, void>(async () => true),
          runDeviceAuth: fromPromise(async () => {
            deviceAuthStarted = true;
            throw new Error('device auth should not be called');
          }),
          fetchStagingCredentials: fromPromise<StagingCredentials, void>(async () => ({
            clientId: 'client_unclaimed',
            apiKey: 'sk_test_unclaimed',
          })),
        },
      });

      const actor = createActor(machine, {
        input: { emitter, options },
      });

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 200));

      expect(deviceAuthStarted).toBe(false);
      expect(actor.getSnapshot().value).toBe('complete');
      actor.stop();
    });
  });

  describe('scaffold flow', () => {
    function createScaffoldActor(opts: { workspace: WorkspaceCheckOutput; runScaffoldImpl?: () => Promise<void> }) {
      const emitter = createInstallerEventEmitter();
      const options: InstallerOptions = {
        debug: false,
        forceInstall: false,
        installDir: '/test/project',
        local: true,
        ci: false,
        skipAuth: true,
        dashboard: false,
        emitter,
      };

      const machine = installerMachine.provide({
        actors: {
          ...baseMockActors,
          checkWorkspace: fromPromise<WorkspaceCheckOutput, { options: InstallerOptions }>(async () => opts.workspace),
          runScaffold: fromPromise<void, { context: InstallerMachineContext }>(
            opts.runScaffoldImpl ?? (async () => {}),
          ),
        },
      });

      const actor = createActor(machine, { input: { emitter, options } });
      return { actor, emitter, options };
    }

    it('skips scaffolding when the directory is not empty', async () => {
      const { actor, emitter } = createScaffoldActor({
        workspace: { scaffoldable: false, packageManager: 'npm', autoScaffold: false },
      });
      const events: string[] = [];
      emitter.on('scaffold:checking', () => events.push('scaffold:checking'));
      emitter.on('scaffold:start', () => events.push('scaffold:start'));

      actor.start();
      actor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 50));

      // Checked the workspace, but never started a scaffold; fell through to the
      // normal install path (left the scaffold state entirely).
      expect(events).toEqual(['scaffold:checking']);
      expect(actor.getSnapshot().context.scaffolded).toBeFalsy();
      expect(actor.getSnapshot().matches('scaffold')).toBe(false);
      actor.stop();
    });

    it('auto-scaffolds without prompting (headless / --scaffold)', async () => {
      let ran = false;
      const { actor, emitter } = createScaffoldActor({
        workspace: { scaffoldable: true, packageManager: 'pnpm', autoScaffold: true },
        runScaffoldImpl: async () => {
          ran = true;
        },
      });
      const started: string[] = [];
      emitter.on('scaffold:start', ({ packageManager }) => started.push(packageManager));
      emitter.on('error', () => {});

      actor.start();
      actor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 100));

      expect(ran).toBe(true);
      expect(started).toEqual(['pnpm']);
      expect(actor.getSnapshot().context.scaffolded).toBe(true);
      actor.stop();
    });

    it('prompts then scaffolds on confirm', async () => {
      let ran = false;
      const { actor, emitter } = createScaffoldActor({
        workspace: { scaffoldable: true, packageManager: 'npm', autoScaffold: false },
        runScaffoldImpl: async () => {
          ran = true;
        },
      });
      let prompted = false;
      emitter.on('scaffold:prompt', () => {
        prompted = true;
      });

      actor.start();
      actor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 50));

      expect(prompted).toBe(true);
      expect(actor.getSnapshot().value).toMatchObject({ scaffold: 'prompting' });
      expect(ran).toBe(false);

      actor.send({ type: 'SCAFFOLD_CONFIRMED' });
      await new Promise((r) => setTimeout(r, 50));

      expect(ran).toBe(true);
      actor.stop();
    });

    it('cancels without scaffolding when the prompt is declined', async () => {
      let ran = false;
      const { actor, emitter } = createScaffoldActor({
        workspace: { scaffoldable: true, packageManager: 'npm', autoScaffold: false },
        runScaffoldImpl: async () => {
          ran = true;
        },
      });
      let skipped = false;
      emitter.on('scaffold:skipped', () => {
        skipped = true;
      });

      actor.start();
      actor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 50));

      actor.send({ type: 'SCAFFOLD_CANCELLED' });
      await new Promise((r) => setTimeout(r, 50));

      expect(ran).toBe(false);
      expect(skipped).toBe(true);
      expect(actor.getSnapshot().value).toBe('cancelled');
      actor.stop();
    });

    it('errors when create-next-app fails, preserving the message', async () => {
      const { actor, emitter } = createScaffoldActor({
        workspace: { scaffoldable: true, packageManager: 'npm', autoScaffold: true },
        runScaffoldImpl: async () => {
          throw new Error('create-next-app exited with code 1');
        },
      });
      let failure: string | undefined;
      emitter.on('scaffold:failed', ({ error }) => {
        failure = error;
      });
      emitter.on('error', () => {});

      actor.start();
      actor.send({ type: 'START' });
      await new Promise((r) => setTimeout(r, 100));

      expect(actor.getSnapshot().value).toBe('error');
      expect(failure).toContain('create-next-app exited with code 1');
      actor.stop();
    });
  });
});
