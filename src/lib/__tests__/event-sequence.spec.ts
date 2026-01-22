/**
 * Event Sequence Tests
 *
 * These tests verify that the wizard state machine emits events correctly
 * and that CLI/Dashboard modes receive identical event sequences.
 *
 * IMPORTANT: These tests use mocked actors and do NOT test the full integration.
 * Before releasing, manually test both modes against a real project:
 *
 * ```bash
 * # Test CLI mode
 * cd /tmp && npx create-next-app@latest test-app --typescript --yes
 * cd test-app && wizard --skip-auth
 *
 * # Test Dashboard mode
 * cd /tmp/test-app && wizard dashboard --skip-auth
 *
 * # Verify both modes:
 * # - Show same progress steps
 * # - Create same files
 * # - Emit exactly one 'complete' event (check logs)
 * ```
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { wizardMachine } from '../wizard-core.js';
import { createEventCapture, compareEventSequences, filterDeterministicEvents } from './test-utils.js';
import type { WizardOptions } from '../../utils/types.js';
import type { DetectionOutput, GitCheckOutput, AgentOutput, WizardMachineContext } from '../wizard-core.types.js';
import { Integration } from '../constants.js';

/**
 * Creates mock actor implementations for testing.
 * All return successful results to ensure deterministic flow.
 *
 * IMPORTANT: Must use fromPromise() to wrap async functions for XState v5.
 */
function createMockActors() {
  return {
    checkAuthentication: fromPromise<boolean, { options: WizardOptions }>(async () => true),
    detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async () => ({
      integration: Integration.nextjs,
    })),
    checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
      isClean: true,
      files: [],
    })),
    configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async () => {}),
    runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => ({
      success: true,
      summary: 'Done!',
    })),
  };
}

/**
 * Creates test options with the given overrides.
 */
function createTestOptions(overrides?: Partial<WizardOptions>): WizardOptions {
  return {
    debug: false,
    forceInstall: false,
    installDir: '/test/project',
    default: false,
    local: true,
    ci: false,
    skipAuth: false,
    dashboard: false,
    emitter: null!, // Will be set per test
    apiKey: 'sk_test_123',
    clientId: 'client_test_123',
    ...overrides,
  } as WizardOptions;
}

/**
 * Runs the machine to completion and returns captured events.
 */
async function runMachineToCompletion(
  options: WizardOptions,
  mockActors: ReturnType<typeof createMockActors>,
  capture: ReturnType<typeof createEventCapture>,
): Promise<void> {
  const machineWithActors = wizardMachine.provide({
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

describe('Event Sequence Parity', () => {
  let mockActors: ReturnType<typeof createMockActors>;

  beforeEach(() => {
    mockActors = createMockActors();
  });

  describe('CLI vs Dashboard mode', () => {
    it('emits identical event sequences for happy path', async () => {
      // Run with CLI mode (dashboard: false)
      const cliCapture = createEventCapture();
      const cliOptions = createTestOptions({ dashboard: false });
      await runMachineToCompletion(cliOptions, mockActors, cliCapture);
      const cliEvents = filterDeterministicEvents(cliCapture.getEventTypes());

      // Reset mocks to ensure identical behavior
      mockActors = createMockActors();

      // Run with Dashboard mode (dashboard: true)
      const dashCapture = createEventCapture();
      const dashOptions = createTestOptions({ dashboard: true });
      await runMachineToCompletion(dashOptions, mockActors, dashCapture);
      const dashEvents = filterDeterministicEvents(dashCapture.getEventTypes());

      // Compare sequences
      const result = compareEventSequences(cliEvents, dashEvents);
      expect(result.match, result.diff).toBe(true);
    });

    it('emits identical events when skipping auth', async () => {
      const cliCapture = createEventCapture();
      await runMachineToCompletion(createTestOptions({ dashboard: false, skipAuth: true }), mockActors, cliCapture);
      const cliEvents = cliCapture.getEventTypes();

      mockActors = createMockActors();

      const dashCapture = createEventCapture();
      await runMachineToCompletion(createTestOptions({ dashboard: true, skipAuth: true }), mockActors, dashCapture);
      const dashEvents = dashCapture.getEventTypes();

      const result = compareEventSequences(cliEvents, dashEvents);
      expect(result.match, result.diff).toBe(true);
    });

    it('emits identical events with dirty git (confirmed)', async () => {
      // Mock dirty git status - override checkGitStatus with dirty result
      const dirtyMockActors = {
        ...createMockActors(),
        checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
          isClean: false,
          files: ['file1.ts', 'file2.ts'],
        })),
      };

      const cliCapture = createEventCapture();
      const cliOptions = createTestOptions({ dashboard: false, skipAuth: true });

      const machineWithActors = wizardMachine.provide({
        actors: dirtyMockActors,
      });

      const cliActor = createActor(machineWithActors, {
        input: {
          emitter: cliCapture.emitter,
          options: { ...cliOptions, emitter: cliCapture.emitter },
        },
      });

      // Start machine and handle git confirmation
      await new Promise<void>((resolve) => {
        cliActor.subscribe({
          complete: () => resolve(),
        });

        cliActor.start();
        cliActor.send({ type: 'START' });

        // Simulate user confirming git status after a tick
        setTimeout(() => {
          cliActor.send({ type: 'GIT_CONFIRMED' });
        }, 50);
      });

      const cliEvents = cliCapture.getEventTypes();

      // Reset and run dashboard mode
      const dashMockActors = {
        ...createMockActors(),
        checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
          isClean: false,
          files: ['file1.ts', 'file2.ts'],
        })),
      };

      const dashCapture = createEventCapture();
      const dashOptions = createTestOptions({ dashboard: true, skipAuth: true });

      const dashMachine = wizardMachine.provide({
        actors: dashMockActors,
      });

      const dashActor = createActor(dashMachine, {
        input: {
          emitter: dashCapture.emitter,
          options: { ...dashOptions, emitter: dashCapture.emitter },
        },
      });

      await new Promise<void>((resolve) => {
        dashActor.subscribe({
          complete: () => resolve(),
        });

        dashActor.start();
        dashActor.send({ type: 'START' });

        setTimeout(() => {
          dashActor.send({ type: 'GIT_CONFIRMED' });
        }, 50);
      });

      const dashEvents = dashCapture.getEventTypes();

      const result = compareEventSequences(cliEvents, dashEvents);
      expect(result.match, result.diff).toBe(true);
    });
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
        runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => ({
          success: false,
          error: new Error('Agent failed'),
        })),
      };

      const capture = createEventCapture();
      const machineWithActors = wizardMachine.provide({
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
        runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => ({
          success: false,
          error: new Error('Agent failed'),
        })),
      };

      const capture = createEventCapture();
      const machineWithActors = wizardMachine.provide({
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
