import { describe, it, expect } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { installerMachine } from './installer-core.js';
import { createInstallerEventEmitter } from './events.js';
import { Integration } from './constants.js';
import type { InstallerOptions } from '../utils/types.js';
import type {
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
  InstallerMachineContext,
  BranchCheckOutput,
} from './installer-core.types.js';

// Shared mock actors for reuse across tests
const baseMockActors = {
  checkAuthentication: fromPromise<boolean, { options: InstallerOptions }>(async () => true),
  detectIntegration: fromPromise<DetectionOutput, { options: InstallerOptions }>(async () => ({
    integration: Integration.nextjs,
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

function createTestActor(overrides?: Partial<InstallerOptions>) {
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
    actors: baseMockActors,
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

    it('skips auth when skipAuth option is true', () => {
      const { actor } = createTestActor({ skipAuth: true });
      actor.start();
      actor.send({ type: 'START' });
      // Should go directly to preparing (parallel state with detection, gitCheck, and branchCheck)
      expect(actor.getSnapshot().value).toEqual({
        preparing: { detection: 'running', gitCheck: 'running', branchCheck: 'running' },
      });
      actor.stop();
    });
  });

  describe('parallel states', () => {
    it('runs detection, git check, and branch check in parallel', async () => {
      const { actor } = createTestActor({ skipAuth: true });
      actor.start();
      actor.send({ type: 'START' });

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

    it('emits state:enter for each state transition', () => {
      const { actor, emitter } = createTestActor({ skipAuth: true });
      const states: string[] = [];
      emitter.on('state:enter', ({ state }) => states.push(state));

      actor.start();
      actor.send({ type: 'START' });

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
  });
});
