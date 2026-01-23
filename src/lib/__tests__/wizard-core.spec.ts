import { describe, it, expect } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { wizardMachine } from '../wizard-core.js';
import { createWizardEventEmitter } from '../events.js';
import { Integration } from '../constants.js';
import type { WizardOptions } from '../../utils/types.js';
import type { DetectionOutput, GitCheckOutput, AgentOutput, WizardMachineContext, CredentialSource } from '../wizard-core.types.js';
import type { EnvFileInfo, DiscoveryResult } from '../credential-discovery.js';
import type { DeviceAuthResponse } from '../device-auth.js';
import type { WizardEventEmitter } from '../events.js';

interface TestActorOverrides {
  options?: Partial<WizardOptions>;
  envFilesExist?: boolean;
  envFiles?: string[];
  envCredentials?: DiscoveryResult;
  hasStoredAuth?: boolean;
  deviceAuthFails?: boolean;
  stagingFails?: boolean;
}

function createTestActor(overrides?: TestActorOverrides) {
  const emitter = createWizardEventEmitter();
  const options: WizardOptions = {
    debug: false,
    forceInstall: false,
    installDir: '/test/project',
    default: false,
    local: true,
    ci: false,
    skipAuth: false,
    dashboard: false,
    emitter,
    ...overrides?.options,
  };

  const mockDeviceAuth: DeviceAuthResponse = {
    device_code: 'device_123',
    user_code: 'USER-CODE',
    verification_uri: 'https://auth.example.com/device',
    verification_uri_complete: 'https://auth.example.com/device?code=USER-CODE',
    expires_in: 600,
    interval: 5,
  };

  // Provide mock implementations for actors
  const machine = wizardMachine.provide({
    actors: {
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

      // New credential resolution actors
      detectEnvFiles: fromPromise<EnvFileInfo, { installDir: string }>(async () => ({
        exists: overrides?.envFilesExist ?? false,
        files: overrides?.envFiles ?? [],
      })),
      scanEnvFiles: fromPromise<DiscoveryResult, { installDir: string }>(async () =>
        overrides?.envCredentials ?? { found: false }
      ),
      checkStoredAuth: fromPromise<boolean, void>(async () => overrides?.hasStoredAuth ?? false),
      runDeviceAuth: fromPromise<{ deviceAuth: DeviceAuthResponse }, { emitter: WizardEventEmitter }>(async () => {
        if (overrides?.deviceAuthFails) {
          throw new Error('Device auth failed');
        }
        return { deviceAuth: mockDeviceAuth };
      }),
      fetchStagingCredentials: fromPromise<{ clientId: string; apiKey: string }, void>(async () => {
        if (overrides?.stagingFails) {
          throw new Error('Staging API failed');
        }
        return { clientId: 'client_staging', apiKey: 'sk_staging' };
      }),
    },
  });

  const actor = createActor(machine, {
    input: { emitter, options },
  });

  return { actor, emitter, options };
}

describe('WizardCore State Machine', () => {
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
      const { actor } = createTestActor({ options: { skipAuth: true } });
      actor.start();
      actor.send({ type: 'START' });
      // Should go directly to preparing (parallel state)
      expect(actor.getSnapshot().value).toEqual({
        preparing: { detection: 'running', gitCheck: 'running' },
      });
      actor.stop();
    });
  });

  describe('parallel states', () => {
    it('runs detection and git check in parallel', async () => {
      const { actor } = createTestActor({ options: { skipAuth: true } });
      actor.start();
      actor.send({ type: 'START' });

      // Both should be running
      const snapshot = actor.getSnapshot();
      expect(snapshot.value).toEqual({
        preparing: { detection: 'running', gitCheck: 'running' },
      });
      actor.stop();
    });
  });

  describe('event emissions', () => {
    it('emits auth:checking when entering authenticating', () => {
      const { actor, emitter } = createTestActor({});
      const events: string[] = [];
      emitter.on('auth:checking', () => events.push('auth:checking'));

      actor.start();
      actor.send({ type: 'START' });

      expect(events).toContain('auth:checking');
      actor.stop();
    });

    it('emits state:enter for each state transition', () => {
      const { actor, emitter } = createTestActor({ options: { skipAuth: true } });
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
      const emitter = createWizardEventEmitter();
      const options: WizardOptions = {
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

      const errorMachine = wizardMachine.provide({
        actors: {
          checkAuthentication: fromPromise<boolean, { options: WizardOptions }>(async () => {
            throw new Error('Auth failed');
          }),
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
          })),
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
      const emitter = createWizardEventEmitter();
      const options: WizardOptions = {
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

      const dirtyMachine = wizardMachine.provide({
        actors: {
          checkAuthentication: fromPromise<boolean, { options: WizardOptions }>(async () => true),
          detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async () => ({
            integration: Integration.nextjs,
          })),
          checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
            isClean: false,
            files: ['file1.ts', 'file2.ts'],
          })),
          configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async () => {}),
          runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => ({
            success: true,
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
      const emitter = createWizardEventEmitter();
      const options: WizardOptions = {
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

      const dirtyMachine = wizardMachine.provide({
        actors: {
          checkAuthentication: fromPromise<boolean, { options: WizardOptions }>(async () => true),
          detectIntegration: fromPromise<DetectionOutput, { options: WizardOptions }>(async () => ({
            integration: Integration.nextjs,
          })),
          checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
            isClean: false,
            files: ['file1.ts'],
          })),
          configureEnvironment: fromPromise<void, { context: WizardMachineContext }>(async () => {}),
          runAgent: fromPromise<AgentOutput, { context: WizardMachineContext }>(async () => ({
            success: true,
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
      const emitter = createWizardEventEmitter();
      const options: WizardOptions = {
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

      const machine = wizardMachine.provide({
        actors: {
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
      // No credentials, no env files, device auth fails -> falls back to manual
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: false,
        hasStoredAuth: false,
        deviceAuthFails: true,
      });

      let credentialsRequested = false;
      emitter.on('credentials:request', () => {
        credentialsRequested = true;
      });

      actor.start();
      actor.send({ type: 'START' });

      // Wait for preparing to complete and credential resolution to run
      await new Promise((r) => setTimeout(r, 200));

      // Should be in promptingManual after device auth fails
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

  describe('credential resolution', () => {
    it('uses CLI flags when provided (skips all other steps)', async () => {
      const { actor, emitter } = createTestActor({
        options: {
          skipAuth: true,
          apiKey: 'sk_cli',
          clientId: 'client_cli',
        },
      });

      const events: string[] = [];
      emitter.on('credentials:found', () => events.push('credentials:found'));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(events).toContain('credentials:found');
      expect(actor.getSnapshot().context.credentialSource).toBe('cli');
      actor.stop();
    });

    it('prompts for env scan consent when env files exist', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: true,
        envFiles: ['.env.local'],
      });

      const events: { type: string; data?: unknown }[] = [];
      emitter.on('credentials:env:prompt', (data) => events.push({ type: 'env:prompt', data }));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 100));

      expect(events).toContainEqual({
        type: 'env:prompt',
        data: { files: ['.env.local'] },
      });
      actor.stop();
    });

    it('skips env scan when user declines', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: true,
        envFiles: ['.env.local'],
        hasStoredAuth: true, // Will use stored auth instead
      });

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 100));

      // Decline env scan
      actor.send({ type: 'ENV_SCAN_DECLINED' });

      await new Promise((r) => setTimeout(r, 200));

      // Should complete using stored auth
      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.envScanConsent).toBe(false);
      actor.stop();
    });

    it('uses env credentials when found and consented', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: true,
        envFiles: ['.env.local'],
        envCredentials: {
          found: true,
          source: 'env',
          clientId: 'client_env',
          apiKey: 'sk_env',
          sourcePath: '.env.local',
        },
      });

      const events: string[] = [];
      emitter.on('credentials:env:found', () => events.push('env:found'));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 100));

      // Approve env scan
      actor.send({ type: 'ENV_SCAN_APPROVED' });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.credentialSource).toBe('env');
      expect(events).toContain('env:found');
      actor.stop();
    });

    it('uses stored auth token when available', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: false,
        hasStoredAuth: true,
      });

      const events: string[] = [];
      emitter.on('staging:success', () => events.push('staging:success'));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.credentialSource).toBe('stored');
      expect(events).toContain('staging:success');
      actor.stop();
    });

    it('runs device auth when no stored token', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: false,
        hasStoredAuth: false,
      });

      const events: string[] = [];
      emitter.on('device:success', () => events.push('device:success'));
      emitter.on('staging:success', () => events.push('staging:success'));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.credentialSource).toBe('device');
      expect(events).toContain('device:success');
      expect(events).toContain('staging:success');
      actor.stop();
    });

    it('falls back to manual entry on device auth failure', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: false,
        hasStoredAuth: false,
        deviceAuthFails: true,
      });

      const events: string[] = [];
      emitter.on('device:error', () => events.push('device:error'));
      emitter.on('credentials:request', () => events.push('credentials:request'));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 200));

      expect(events).toContain('device:error');
      expect(events).toContain('credentials:request');

      // Submit manual credentials
      actor.send({
        type: 'CREDENTIALS_SUBMITTED',
        apiKey: 'sk_manual',
        clientId: 'client_manual',
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.credentialSource).toBe('manual');
      actor.stop();
    });

    it('falls back to manual entry on staging API failure', async () => {
      const { actor, emitter } = createTestActor({
        options: { skipAuth: true },
        envFilesExist: false,
        hasStoredAuth: true,
        stagingFails: true,
      });

      const events: string[] = [];
      emitter.on('staging:error', () => events.push('staging:error'));
      emitter.on('credentials:request', () => events.push('credentials:request'));

      actor.start();
      actor.send({ type: 'START' });

      await new Promise((r) => setTimeout(r, 200));

      expect(events).toContain('staging:error');
      expect(events).toContain('credentials:request');

      // Submit manual credentials
      actor.send({
        type: 'CREDENTIALS_SUBMITTED',
        apiKey: 'sk_manual',
        clientId: 'client_manual',
      });

      await new Promise((r) => setTimeout(r, 200));

      expect(actor.getSnapshot().value).toBe('complete');
      expect(actor.getSnapshot().context.credentialSource).toBe('manual');
      actor.stop();
    });

    it('allows retry from manual prompt', async () => {
      const emitter = createWizardEventEmitter();
      const options: WizardOptions = {
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

      let deviceAuthCallCount = 0;

      const machine = wizardMachine.provide({
        actors: {
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
          })),
          detectEnvFiles: fromPromise<EnvFileInfo, { installDir: string }>(async () => ({
            exists: false,
            files: [],
          })),
          scanEnvFiles: fromPromise<DiscoveryResult, { installDir: string }>(async () => ({ found: false })),
          checkStoredAuth: fromPromise<boolean, void>(async () => false),
          runDeviceAuth: fromPromise<{ deviceAuth: DeviceAuthResponse }, { emitter: WizardEventEmitter }>(async () => {
            deviceAuthCallCount++;
            if (deviceAuthCallCount === 1) {
              throw new Error('First attempt failed');
            }
            return {
              deviceAuth: {
                device_code: 'device_123',
                user_code: 'USER-CODE',
                verification_uri: 'https://auth.example.com/device',
                verification_uri_complete: 'https://auth.example.com/device?code=USER-CODE',
                expires_in: 600,
                interval: 5,
              },
            };
          }),
          fetchStagingCredentials: fromPromise<{ clientId: string; apiKey: string }, void>(async () => ({
            clientId: 'client_staging',
            apiKey: 'sk_staging',
          })),
        },
      });

      const actor = createActor(machine, {
        input: { emitter, options },
      });

      actor.start();
      actor.send({ type: 'START' });

      // Wait for first device auth to fail
      await new Promise((r) => setTimeout(r, 200));

      expect(deviceAuthCallCount).toBe(1);

      // Retry auth
      actor.send({ type: 'RETRY_AUTH' });

      await new Promise((r) => setTimeout(r, 200));

      expect(deviceAuthCallCount).toBe(2);
      expect(actor.getSnapshot().value).toBe('complete');
      actor.stop();
    });
  });
});
