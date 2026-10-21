/**
 * Event Sequence Tests
 *
 * These tests verify that the installer state machine emits events correctly.
 *
 * IMPORTANT: These tests use mocked actors and do NOT test the full integration.
 * Before releasing, manually test against a real project:
 *
 * ```bash
 * cd /tmp && npx create-next-app@latest test-app --typescript --yes
 * cd test-app && workos install --skip-auth
 * ```
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { installerMachine } from './installer-core.js';
import { createEventCapture } from './installer-core.test-utils.js';
import type { InstallerOptions } from '../utils/types.js';
import type {
  DetectionOutput,
  GitCheckOutput,
  AgentOutput,
  InstallerMachineContext,
  WorkspaceCheckOutput,
} from './installer-core.types.js';

/**
 * Creates mock actor implementations for testing.
 * All return successful results to ensure deterministic flow.
 *
 * IMPORTANT: Must use fromPromise() to wrap async functions for XState v5.
 */
function createMockActors() {
  return {
    checkAuthentication: fromPromise<boolean, { options: InstallerOptions }>(async () => true),
    // Default: not an empty dir, so the scaffold state falls straight through.
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
    configureEnvironment: fromPromise<void, { context: InstallerMachineContext }>(async () => {}),
    runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
      success: true,
      summary: 'Done!',
    })),
  };
}

/**
 * Creates test options with the given overrides.
 */
function createTestOptions(overrides?: Partial<InstallerOptions>): InstallerOptions {
  return {
    debug: false,
    forceInstall: false,
    installDir: '/test/project',
    default: false,
    local: true,
    ci: false,
    skipAuth: false,
    emitter: null!, // Will be set per test
    apiKey: 'sk_test_123',
    clientId: 'client_test_123',
    ...overrides,
  } as InstallerOptions;
}

/**
 * Runs the machine to completion and returns captured events.
 */
async function runMachineToCompletion(
  options: InstallerOptions,
  mockActors: ReturnType<typeof createMockActors>,
  capture: ReturnType<typeof createEventCapture>,
): Promise<void> {
  const machineWithActors = installerMachine.provide({
    actors: mockActors,
  });

  const actor = createActor(machineWithActors, {
    input: {
      emitter: capture.emitter,
      options: { ...options, emitter: capture.emitter },
    },
  });

  await new Promise<void>((resolve, reject) => {
    actor.subscribe({
      complete: () => resolve(),
      error: (err) => reject(err),
    });

    actor.start();
    actor.send({ type: 'START' });
  });
}

describe('Installer event sequences', () => {
  let mockActors: ReturnType<typeof createMockActors>;

  beforeEach(() => {
    mockActors = createMockActors();
  });

  describe('event correctness', () => {
    it('emits state:enter for each state transition', async () => {
      const capture = createEventCapture();
      await runMachineToCompletion(createTestOptions({ skipAuth: true }), mockActors, capture);

      const stateEnterEvents = capture.getEventsOfType('state:enter');
      const states = stateEnterEvents.map((e) => e.payload.state);

      // Should have entered these states
      expect(states).toContain('preparing');
      expect(states).toContain('gatheringCredentials');
      expect(states).toContain('configuring');
      expect(states).toContain('runningAgent');
      expect(states).toContain('complete');
    });

    it('emits complete event with success on happy path', async () => {
      const capture = createEventCapture();
      await runMachineToCompletion(createTestOptions(), mockActors, capture);

      const completeEvents = capture.getEventsOfType('complete');
      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].payload.success).toBe(true);
    });

    it('emits agent:start before agent:success', async () => {
      const capture = createEventCapture();
      await runMachineToCompletion(createTestOptions(), mockActors, capture);

      const events = capture.getEventTypes();
      const startIndex = events.indexOf('agent:start');
      const successIndex = events.indexOf('agent:success');

      expect(startIndex).toBeGreaterThan(-1);
      expect(successIndex).toBeGreaterThan(-1);
      expect(startIndex).toBeLessThan(successIndex);
    });
  });

  describe('no duplicate events', () => {
    it('emits exactly one complete event on success', async () => {
      const capture = createEventCapture();
      await runMachineToCompletion(createTestOptions(), mockActors, capture);

      const completeEvents = capture.getEventsOfType('complete');
      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].payload.success).toBe(true);
    });

    it('emits exactly one agent:success event', async () => {
      const capture = createEventCapture();
      await runMachineToCompletion(createTestOptions(), mockActors, capture);

      const successEvents = capture.getEventsOfType('agent:success');
      expect(successEvents.length).toBe(1);
    });

    it('emits exactly one agent:start event', async () => {
      const capture = createEventCapture();
      await runMachineToCompletion(createTestOptions(), mockActors, capture);

      const startEvents = capture.getEventsOfType('agent:start');
      expect(startEvents.length).toBe(1);
    });

    it('emits exactly one complete event on agent failure', async () => {
      const failingActors = {
        ...createMockActors(),
        runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
          success: false,
          error: new Error('Agent failed'),
        })),
      };

      const capture = createEventCapture();
      const machineWithActors = installerMachine.provide({
        actors: failingActors,
      });

      const actor = createActor(machineWithActors, {
        input: {
          emitter: capture.emitter,
          options: { ...createTestOptions(), emitter: capture.emitter },
        },
      });

      await new Promise<void>((resolve) => {
        actor.subscribe({ complete: () => resolve() });
        actor.start();
        actor.send({ type: 'START' });
      });

      const completeEvents = capture.getEventsOfType('complete');
      expect(completeEvents.length).toBe(1);
      expect(completeEvents[0].payload.success).toBe(false);
    });

    it('emits exactly one agent:failure event on failure', async () => {
      const failingActors = {
        ...createMockActors(),
        runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
          success: false,
          error: new Error('Agent failed'),
        })),
      };

      const capture = createEventCapture();
      const machineWithActors = installerMachine.provide({
        actors: failingActors,
      });

      const actor = createActor(machineWithActors, {
        input: {
          emitter: capture.emitter,
          options: { ...createTestOptions(), emitter: capture.emitter },
        },
      });

      await new Promise<void>((resolve) => {
        actor.subscribe({ complete: () => resolve() });
        actor.start();
        actor.send({ type: 'START' });
      });

      const failureEvents = capture.getEventsOfType('agent:failure');
      expect(failureEvents.length).toBe(1);
    });
  });
});
