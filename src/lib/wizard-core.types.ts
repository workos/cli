import type { WizardEventEmitter } from './events.js';
import type { WizardOptions } from '../utils/types.js';
import type { Integration } from './constants.js';
import type { DeviceAuthResponse } from './device-auth.js';

/**
 * How credentials were obtained.
 */
export type CredentialSource = 'cli' | 'env' | 'stored' | 'device' | 'manual';

/**
 * Context passed to the wizard state machine.
 * Contains all data needed throughout the wizard flow.
 */
export interface WizardMachineContext {
  /** Event emitter for UI communication */
  emitter: WizardEventEmitter;
  /** CLI options from command line args */
  options: WizardOptions;
  /** Detected or selected framework integration */
  integration: Integration | undefined;
  /** WorkOS credentials gathered from user */
  credentials: { apiKey: string; clientId: string } | undefined;
  /** Whether git working directory is clean */
  gitIsClean: boolean;
  /** List of dirty git files (if any) */
  gitDirtyFiles: string[];
  /** Error that caused failure (if any) */
  error: Error | undefined;

  /** How credentials were obtained */
  credentialSource?: CredentialSource;

  /** Device auth state for UI */
  deviceAuth?: {
    verificationUri: string;
    verificationUriComplete: string;
    userCode: string;
  };

  /** Whether user consented to env scanning */
  envScanConsent?: boolean;

  /** Discovered env files (before consent) */
  envFilesDetected?: string[];
}

/**
 * Input provided when creating the machine actor.
 * These values initialize the context.
 */
export interface WizardMachineInput {
  emitter: WizardEventEmitter;
  options: WizardOptions;
}

/**
 * All events the wizard machine can receive.
 */
export type WizardMachineEvent =
  | { type: 'START' }
  | { type: 'SKIP_AUTH' }
  | { type: 'GIT_CONFIRMED' }
  | { type: 'GIT_CANCELLED' }
  | { type: 'CREDENTIALS_SUBMITTED'; apiKey: string; clientId: string }
  | { type: 'CANCEL' }
  | { type: 'ENV_SCAN_APPROVED' }
  | { type: 'ENV_SCAN_DECLINED' }
  | { type: 'DEVICE_AUTH_STARTED'; deviceAuth: DeviceAuthResponse }
  | { type: 'RETRY_AUTH' };

/**
 * Output from the detection actor.
 */
export interface DetectionOutput {
  integration: Integration | undefined;
}

/**
 * Output from the git check actor.
 */
export interface GitCheckOutput {
  isClean: boolean;
  files: string[];
}

/**
 * Output from the agent actor.
 */
export interface AgentOutput {
  success: boolean;
  summary?: string;
  error?: Error;
}
