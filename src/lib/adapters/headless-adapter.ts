import type { InstallerAdapter, AdapterConfig } from './types.js';
import type { InstallerEventEmitter, InstallerEvents } from '../events.js';
import { writeNDJSON } from '../../utils/ndjson.js';
import { ExitCode } from '../../utils/exit-codes.js';

/**
 * Options controlling headless adapter behavior.
 * Corresponds to CLI flags passed in non-interactive mode.
 */
export interface HeadlessOptions {
  apiKey?: string;
  clientId?: string;
  noBranch?: boolean;
  noCommit?: boolean;
  createPr?: boolean;
  noGitCheck?: boolean;
}

/**
 * Non-interactive adapter for CI/CD and agent consumption.
 *
 * Subscribes to the same installer events as CLIAdapter but never prompts.
 * All decisions are auto-resolved with sensible defaults (overridable via flags).
 * Progress is streamed as NDJSON to stdout.
 */
export class HeadlessAdapter implements InstallerAdapter {
  readonly emitter: InstallerEventEmitter;
  private sendEvent: AdapterConfig['sendEvent'];
  private debug: boolean;
  private options: HeadlessOptions;
  private isStarted = false;
  private handlers = new Map<string, (...args: unknown[]) => void>();

  constructor(config: AdapterConfig & { options: HeadlessOptions }) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
    this.debug = config.debug ?? false;
    this.options = config.options;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    // Auth events
    this.subscribe('auth:success', this.handleAuthSuccess);
    this.subscribe('auth:failure', this.handleAuthFailure);

    // Detection events
    this.subscribe('detection:complete', this.handleDetectionComplete);
    this.subscribe('detection:none', this.handleDetectionNone);

    // Git events — auto-resolve
    this.subscribe('git:dirty', this.handleGitDirty);

    // Credential events — auto-resolve
    this.subscribe('credentials:found', this.handleCredentialsFound);
    this.subscribe('credentials:request', this.handleCredentialsRequest);
    this.subscribe('credentials:env:prompt', this.handleEnvScanPrompt);
    this.subscribe('credentials:env:found', this.handleEnvCredentialsFound);

    // Device auth (should not happen in headless, but log if it does)
    this.subscribe('device:started', this.handleDeviceStarted);

    // Staging
    this.subscribe('staging:fetching', this.handleStagingFetching);
    this.subscribe('staging:success', this.handleStagingSuccess);

    // Config
    this.subscribe('config:complete', this.handleConfigComplete);

    // Agent progress
    this.subscribe('agent:start', this.handleAgentStart);
    this.subscribe('agent:progress', this.handleAgentProgress);

    // Validation
    this.subscribe('validation:start', this.handleValidationStart);
    this.subscribe('validation:issues', this.handleValidationIssues);
    this.subscribe('validation:complete', this.handleValidationComplete);

    // Branch — auto-resolve
    this.subscribe('branch:prompt', this.handleBranchPrompt);
    this.subscribe('branch:created', this.handleBranchCreated);

    // Post-install — auto-resolve
    this.subscribe('postinstall:changes', this.handlePostInstallChanges);
    this.subscribe('postinstall:commit:prompt', this.handleCommitPrompt);
    this.subscribe('postinstall:commit:success', this.handleCommitSuccess);
    this.subscribe('postinstall:commit:failed', this.handleCommitFailed);
    this.subscribe('postinstall:pr:prompt', this.handlePrPrompt);
    this.subscribe('postinstall:pr:success', this.handlePrSuccess);
    this.subscribe('postinstall:pr:failed', this.handlePrFailed);
    this.subscribe('postinstall:push:failed', this.handlePushFailed);
    this.subscribe('postinstall:manual', this.handleManualInstructions);

    // Terminal events
    this.subscribe('complete', this.handleComplete);
    this.subscribe('error', this.handleError);
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;

    for (const [event, handler] of this.handlers) {
      this.emitter.off(event as keyof InstallerEvents, handler as never);
    }
    this.handlers.clear();
    this.isStarted = false;
  }

  private subscribe<K extends keyof InstallerEvents>(
    event: K,
    handler: (payload: InstallerEvents[K]) => void | Promise<void>,
  ): void {
    const boundHandler = handler.bind(this);
    this.handlers.set(event, boundHandler as (...args: unknown[]) => void);
    this.emitter.on(event, boundHandler);
  }

  private debugLog(message: string): void {
    if (this.debug) {
      writeNDJSON({ type: 'debug', message });
    }
  }

  // ===== Auth Handlers =====

  private handleAuthSuccess = (): void => {
    writeNDJSON({ type: 'auth:success' });
  };

  private handleAuthFailure = ({ message }: InstallerEvents['auth:failure']): void => {
    writeNDJSON({ type: 'auth:required', message });
    process.exit(ExitCode.AUTH_REQUIRED);
  };

  // ===== Detection Handlers =====

  private handleDetectionComplete = ({ integration }: InstallerEvents['detection:complete']): void => {
    writeNDJSON({ type: 'detection:complete', integration });
  };

  private handleDetectionNone = (): void => {
    writeNDJSON({ type: 'detection:none' });
  };

  // ===== Git Handlers (auto-resolve) =====

  private handleGitDirty = ({ files }: InstallerEvents['git:dirty']): void => {
    writeNDJSON({ type: 'git:status', dirty: true, files });

    if (this.options.noGitCheck) {
      writeNDJSON({ type: 'git:decision', action: 'continue' });
      this.sendEvent({ type: 'GIT_CONFIRMED' });
      return;
    }

    writeNDJSON({
      type: 'error',
      code: 'git_dirty',
      message:
        'Git working tree is dirty in non-interactive mode. ' +
        'Commit or stash your changes, or rerun with --no-git-check to proceed.',
    });
    writeNDJSON({ type: 'git:decision', action: 'cancel' });
    this.sendEvent({ type: 'GIT_CANCELLED' });
    process.exit(ExitCode.GENERAL_ERROR);
  };

  // ===== Credential Handlers (auto-resolve) =====

  private handleCredentialsFound = (): void => {
    writeNDJSON({ type: 'credentials:found', source: 'env' });
  };

  private handleCredentialsRequest = ({ requiresApiKey }: InstallerEvents['credentials:request']): void => {
    if (!this.options.clientId) {
      writeNDJSON({
        type: 'error',
        code: 'missing_credentials',
        message: 'Client ID required in non-interactive mode. Pass --client-id flag.',
      });
      process.exit(ExitCode.GENERAL_ERROR);
    }

    if (requiresApiKey && !this.options.apiKey) {
      writeNDJSON({
        type: 'error',
        code: 'missing_credentials',
        message: 'API key required for this framework. Pass --api-key flag.',
      });
      process.exit(ExitCode.GENERAL_ERROR);
    }

    writeNDJSON({ type: 'credentials:provided', source: 'flag' });
    this.sendEvent({
      type: 'CREDENTIALS_SUBMITTED',
      apiKey: this.options.apiKey ?? '',
      clientId: this.options.clientId,
    });
  };

  private handleEnvScanPrompt = (): void => {
    writeNDJSON({ type: 'credentials:env:scanning' });
    this.sendEvent({ type: 'ENV_SCAN_APPROVED' });
  };

  private handleEnvCredentialsFound = ({ sourcePath }: InstallerEvents['credentials:env:found']): void => {
    writeNDJSON({ type: 'credentials:found', source: 'env', sourcePath });
  };

  // ===== Device Auth (should not occur in headless) =====

  private handleDeviceStarted = ({ verificationUri, userCode }: InstallerEvents['device:started']): void => {
    writeNDJSON({
      type: 'auth:device_required',
      verificationUri,
      userCode,
      message: 'Device auth cannot proceed in non-interactive mode',
    });
  };

  // ===== Staging =====

  private handleStagingFetching = (): void => {
    writeNDJSON({ type: 'staging:fetching' });
  };

  private handleStagingSuccess = (): void => {
    writeNDJSON({ type: 'staging:success' });
  };

  // ===== Config =====

  private handleConfigComplete = (): void => {
    writeNDJSON({ type: 'config:complete' });
  };

  // ===== Agent Progress =====

  private handleAgentStart = (): void => {
    writeNDJSON({ type: 'agent:start' });
  };

  private handleAgentProgress = ({ step, detail }: InstallerEvents['agent:progress']): void => {
    const message = detail ? `${step}: ${detail}` : step;
    writeNDJSON({ type: 'agent:progress', message });
  };

  // ===== Validation =====

  private handleValidationStart = ({ framework }: InstallerEvents['validation:start']): void => {
    writeNDJSON({ type: 'validation:start', framework });
  };

  private handleValidationIssues = ({ issues }: InstallerEvents['validation:issues']): void => {
    for (const issue of issues) {
      writeNDJSON({ type: 'validation:issue', severity: issue.severity, message: issue.message });
    }
  };

  private handleValidationComplete = ({ passed, issueCount }: InstallerEvents['validation:complete']): void => {
    writeNDJSON({ type: 'validation:complete', passed, issues: issueCount });
  };

  // ===== Branch (auto-resolve) =====

  private handleBranchPrompt = (): void => {
    if (this.options.noBranch) {
      writeNDJSON({ type: 'branch:skipped', reason: '--no-branch flag' });
      this.sendEvent({ type: 'BRANCH_CONTINUE' });
    } else {
      writeNDJSON({ type: 'branch:creating' });
      this.sendEvent({ type: 'BRANCH_CREATE' });
    }
  };

  private handleBranchCreated = ({ branch }: InstallerEvents['branch:created']): void => {
    writeNDJSON({ type: 'branch:created', name: branch });
  };

  // ===== Post-install (auto-resolve) =====

  private handlePostInstallChanges = ({ files }: InstallerEvents['postinstall:changes']): void => {
    writeNDJSON({ type: 'postinstall:changes', files, count: files.length });
  };

  private handleCommitPrompt = (): void => {
    if (this.options.noCommit) {
      writeNDJSON({ type: 'commit:skipped', reason: '--no-commit flag' });
      this.sendEvent({ type: 'COMMIT_DECLINED' });
    } else {
      writeNDJSON({ type: 'commit:auto' });
      this.sendEvent({ type: 'COMMIT_APPROVED' });
    }
  };

  private handleCommitSuccess = ({ message }: InstallerEvents['postinstall:commit:success']): void => {
    writeNDJSON({ type: 'commit:created', message });
  };

  private handleCommitFailed = ({ error }: InstallerEvents['postinstall:commit:failed']): void => {
    writeNDJSON({ type: 'commit:failed', error });
  };

  private handlePrPrompt = (): void => {
    if (this.options.createPr) {
      writeNDJSON({ type: 'pr:creating' });
      this.sendEvent({ type: 'PR_APPROVED' });
    } else {
      writeNDJSON({ type: 'pr:skipped', reason: '--create-pr not set' });
      this.sendEvent({ type: 'PR_DECLINED' });
    }
  };

  private handlePrSuccess = ({ url }: InstallerEvents['postinstall:pr:success']): void => {
    writeNDJSON({ type: 'pr:created', url });
  };

  private handlePrFailed = ({ error }: InstallerEvents['postinstall:pr:failed']): void => {
    writeNDJSON({ type: 'pr:failed', error });
  };

  private handlePushFailed = ({ error }: InstallerEvents['postinstall:push:failed']): void => {
    writeNDJSON({ type: 'push:failed', error });
  };

  private handleManualInstructions = ({ instructions }: InstallerEvents['postinstall:manual']): void => {
    writeNDJSON({ type: 'postinstall:manual', instructions });
  };

  // ===== Terminal Events =====

  private handleComplete = ({ success, summary }: InstallerEvents['complete']): void => {
    writeNDJSON({ type: 'complete', success, summary });
  };

  private handleError = ({ message, stack }: InstallerEvents['error']): void => {
    writeNDJSON({ type: 'error', code: 'installer_error', message });
    this.debugLog(stack ?? '');
  };
}
