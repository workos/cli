import type { WizardEventEmitter } from './events.js';
import type { WizardOptions } from '../utils/types.js';
import type { Integration } from './constants.js';
import type { DeviceAuthResponse } from './device-auth.js';
import type { EnvFileInfo, DiscoveryResult } from './credential-discovery.js';

export type { EnvFileInfo, DiscoveryResult };
export type { DeviceAuthResponse };

/**
 * How credentials were resolved.
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
  credentials: { apiKey?: string; clientId: string } | undefined;
  /** Whether git working directory is clean */
  gitIsClean: boolean;
  /** List of dirty git files (if any) */
  gitDirtyFiles: string[];
  /** Error that caused failure (if any) */
  error: Error | undefined;
  /** How credentials were resolved */
  credentialSource?: CredentialSource;
  /** Device auth state for UI display */
  deviceAuth?: {
    verificationUri: string;
    verificationUriComplete: string;
    userCode: string;
  };
  /** Whether user consented to env file scanning */
  envScanConsent?: boolean;
  /** Env files detected in project (before consent) */
  envFilesDetected?: string[];
  /** Path to env file where credentials were found */
  envCredentialPath?: string;
  /** Current git branch name */
  currentBranch?: string;
  /** Whether current branch is protected */
  isProtectedBranch?: boolean;
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
  // Credential discovery events
  | { type: 'ENV_SCAN_APPROVED' }
  | { type: 'ENV_SCAN_DECLINED' }
  | { type: 'RETRY_AUTH' }
  // Branch check events
  | { type: 'BRANCH_CREATE' }
  | { type: 'BRANCH_CONTINUE' }
  | { type: 'BRANCH_CANCEL' };

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

/**
 * Output from the branch check actor.
 */
export interface BranchCheckOutput {
  branch: string | null;
  isProtected: boolean;
}
