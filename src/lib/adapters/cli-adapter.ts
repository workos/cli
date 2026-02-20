import type { InstallerAdapter, AdapterConfig } from './types.js';
import type { InstallerEventEmitter, InstallerEvents } from '../events.js';
import clack from '../../utils/clack.js';
import chalk from 'chalk';
import { getConfig } from '../settings.js';
import { ProgressTracker } from '../progress-tracker.js';

/**
 * CLI adapter that renders wizard events via clack.
 *
 * Subscribes to InstallerEventEmitter and translates events into
 * clack UI operations (logs, spinners, prompts).
 */
export class CLIAdapter implements InstallerAdapter {
  readonly emitter: InstallerEventEmitter;
  private sendEvent: AdapterConfig['sendEvent'];
  private debug: boolean;
  private spinner: ReturnType<typeof clack.spinner> | null = null;
  private isStarted = false;
  private progress = new ProgressTracker();
  private productName: string;

  // Store bound handlers for cleanup
  private handlers = new Map<string, (...args: unknown[]) => void>();

  // Queue for logs while prompt is active (parallel state issue)
  private isPromptActive = false;
  private pendingLogs: Array<() => void> = [];

  // SIGINT handler for cleanup
  private sigIntHandler: (() => void) | null = null;

  // Long-running agent update interval
  private agentUpdateInterval: NodeJS.Timeout | null = null;
  private hasAgentProgress = false;

  constructor(config: AdapterConfig) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
    this.debug = config.debug ?? false;
    this.productName = config.productName ?? 'AuthKit';
  }

  /**
   * Queue a log call if a prompt is active, otherwise execute immediately.
   */
  private queueableLog(logFn: () => void): void {
    if (this.isPromptActive) {
      this.pendingLogs.push(logFn);
    } else {
      logFn();
    }
  }

  /**
   * Flush any queued logs after prompt completes.
   */
  private flushPendingLogs(): void {
    const logs = this.pendingLogs.splice(0);
    logs.forEach((fn) => fn());
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    // Show intro
    const config = getConfig();
    if (config.branding.showAsciiArt) {
      const art = config.branding.useCompact ? config.branding.compactAsciiArt : config.branding.asciiArt;
      console.log(chalk.cyan(art));
      console.log();
    } else {
      clack.intro(`Welcome to the WorkOS ${this.productName} installer`);
    }

    // Handle Ctrl+C gracefully
    const handleSigInt = () => {
      if (this.spinner) {
        this.spinner.stop('Cancelled');
        this.spinner = null;
      }
      this.stopAgentUpdates();
      clack.log.warn('Installer cancelled');
      clack.outro('Your project was not modified');
      process.exit(0);
    };
    process.on('SIGINT', handleSigInt);
    this.sigIntHandler = handleSigInt;

    // Subscribe to state events for progress tracking
    this.subscribe('state:enter', this.handleStateEnter);
    this.subscribe('state:exit', this.handleStateExit);

    // Subscribe to events that require UI rendering
    this.subscribe('auth:success', this.handleAuthSuccess);
    this.subscribe('auth:failure', this.handleAuthFailure);
    this.subscribe('detection:complete', this.handleDetectionComplete);
    this.subscribe('detection:none', this.handleDetectionNone);
    this.subscribe('git:dirty', this.handleGitDirty);
    this.subscribe('credentials:found', this.handleCredentialsFound);
    this.subscribe('credentials:request', this.handleCredentialsRequest);
    this.subscribe('credentials:env:prompt', this.handleEnvScanPrompt);
    this.subscribe('device:started', this.handleDeviceStarted);
    this.subscribe('device:success', this.handleDeviceSuccess);
    this.subscribe('staging:fetching', this.handleStagingFetching);
    this.subscribe('staging:success', this.handleStagingSuccess);
    this.subscribe('credentials:env:found', this.handleEnvCredentialsFound);
    this.subscribe('config:complete', this.handleConfigComplete);
    this.subscribe('agent:start', this.handleAgentStart);
    this.subscribe('agent:progress', this.handleAgentProgress);
    this.subscribe('validation:start', this.handleValidationStart);
    this.subscribe('validation:issues', this.handleValidationIssues);
    this.subscribe('validation:complete', this.handleValidationComplete);
    this.subscribe('complete', this.handleComplete);
    this.subscribe('error', this.handleError);
    // Branch check events
    this.subscribe('branch:prompt', this.handleBranchPrompt);
    this.subscribe('branch:created', this.handleBranchCreated);

    // Post-install events
    this.subscribe('postinstall:changes', this.handlePostInstallChanges);
    this.subscribe('postinstall:commit:prompt', this.handleCommitPrompt);
    this.subscribe('postinstall:commit:generating', this.handleCommitGenerating);
    this.subscribe('postinstall:commit:success', this.handleCommitSuccess);
    this.subscribe('postinstall:commit:failed', this.handleCommitFailed);
    this.subscribe('postinstall:pr:prompt', this.handlePrPrompt);
    this.subscribe('postinstall:pr:generating', this.handlePrGenerating);
    this.subscribe('postinstall:pr:pushing', this.handlePrPushing);
    this.subscribe('postinstall:pr:success', this.handlePrSuccess);
    this.subscribe('postinstall:pr:failed', this.handlePrFailed);
    this.subscribe('postinstall:push:failed', this.handlePushFailed);
    this.subscribe('postinstall:manual', this.handleManualInstructions);
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;

    // Remove SIGINT handler
    if (this.sigIntHandler) {
      process.off('SIGINT', this.sigIntHandler);
      this.sigIntHandler = null;
    }

    // Stop agent updates
    this.stopAgentUpdates();

    // Unsubscribe from all events
    for (const [event, handler] of this.handlers) {
      this.emitter.off(event as keyof InstallerEvents, handler as never);
    }
    this.handlers.clear();

    // Stop any active spinner
    this.spinner?.stop();
    this.spinner = null;

    this.isStarted = false;
  }

  private stopAgentUpdates = (): void => {
    if (this.agentUpdateInterval) {
      clearInterval(this.agentUpdateInterval);
      this.agentUpdateInterval = null;
    }
  };

  private stopSpinner(message: string): void {
    if (this.spinner) {
      this.spinner.stop(message);
      this.spinner = null;
    }
  }

  /** Debug logging - only outputs when debug mode is enabled */
  private debugLog = (message: string): void => {
    if (this.debug) {
      console.log(chalk.dim(`[debug] ${message}`));
    }
  };

  /**
   * Helper to subscribe and track handlers for cleanup.
   */
  private subscribe<K extends keyof InstallerEvents>(
    event: K,
    handler: (payload: InstallerEvents[K]) => void | Promise<void>,
  ): void {
    const boundHandler = handler.bind(this);
    this.handlers.set(event, boundHandler as (...args: unknown[]) => void);
    this.emitter.on(event, boundHandler);
  }

  // ===== Event Handlers =====

  private handleStateEnter = ({ state }: InstallerEvents['state:enter']): void => {
    this.progress.enterPhase(state);
  };

  private handleStateExit = ({ state }: InstallerEvents['state:exit']): void => {
    this.progress.exitPhase(state);
  };

  private handleAuthSuccess = (): void => {
    clack.log.success('Authenticated');
  };

  private handleAuthFailure = ({ message }: InstallerEvents['auth:failure']): void => {
    clack.log.error(`Auth failed: ${message}`);
    clack.log.info('Visit https://dashboard.workos.com to verify your account');
  };

  private handleDetectionComplete = ({ integration }: InstallerEvents['detection:complete']): void => {
    this.queueableLog(() => clack.log.success(`Detected ${chalk.bold(integration)}`));
  };

  private handleDetectionNone = (): void => {
    this.queueableLog(() => clack.log.warn('Could not detect framework automatically'));
  };

  private handleCredentialsFound = (): void => {
    clack.log.success('Found existing WorkOS credentials in .env.local');
  };

  private handleEnvScanPrompt = async ({ files }: InstallerEvents['credentials:env:prompt']): Promise<void> => {
    this.isPromptActive = true;
    const fileList = files.length === 1 ? files[0] : files.slice(0, 2).join(', ');
    const confirmed = await clack.confirm({
      message: `Found ${fileList}. Check for existing WorkOS credentials?`,
      initialValue: true,
    });
    this.isPromptActive = false;
    this.flushPendingLogs();

    this.sendEvent({
      type: clack.isCancel(confirmed) || !confirmed ? 'ENV_SCAN_DECLINED' : 'ENV_SCAN_APPROVED',
    });
  };

  private handleDeviceStarted = ({ verificationUri, userCode }: InstallerEvents['device:started']): void => {
    clack.log.info(`\nOpen this URL in your browser:\n`);
    console.log(`  ${chalk.cyan(verificationUri)}`);
    console.log(`\nEnter code: ${chalk.bold(userCode)}\n`);

    this.spinner = clack.spinner();
    this.spinner.start('Waiting for authentication...');
  };

  private handleDeviceSuccess = (): void => {
    // Spinner will be stopped by handleStagingFetching
  };

  private handleStagingFetching = (): void => {
    if (this.spinner) {
      this.spinner.stop('Authenticated');
    }
    this.spinner = clack.spinner();
    this.spinner.start('Fetching your WorkOS credentials...');
  };

  private handleStagingSuccess = (): void => {
    this.stopSpinner('Credentials fetched');
    clack.log.success('WorkOS credentials retrieved automatically');
  };

  private handleEnvCredentialsFound = ({ sourcePath }: InstallerEvents['credentials:env:found']): void => {
    clack.log.success(`Found existing WorkOS credentials in ${sourcePath}`);
  };

  private handleGitDirty = async ({ files }: InstallerEvents['git:dirty']): Promise<void> => {
    clack.log.warn('You have uncommitted or untracked files:');
    files.slice(0, 5).forEach((f) => clack.log.info(chalk.dim(`  ${f}`)));
    if (files.length > 5) {
      clack.log.info(chalk.dim(`  ... and ${files.length - 5} more`));
    }

    this.isPromptActive = true;
    const confirmed = await clack.confirm({
      message: 'Continue anyway?',
      initialValue: false,
    });
    this.isPromptActive = false;
    this.flushPendingLogs();

    this.sendEvent({
      type: clack.isCancel(confirmed) || !confirmed ? 'GIT_CANCELLED' : 'GIT_CONFIRMED',
    });
  };

  private handleCredentialsRequest = async ({
    requiresApiKey,
  }: InstallerEvents['credentials:request']): Promise<void> => {
    clack.log.step(`Get your credentials from ${chalk.cyan('https://dashboard.workos.com')}`);

    const clientId = await clack.text({
      message: 'Enter your WorkOS Client ID:',
      placeholder: 'client_...',
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return 'Client ID is required';
        }
        if (!value.startsWith('client_')) {
          return 'Client ID should start with "client_"';
        }
        return undefined;
      },
    });

    if (clack.isCancel(clientId)) {
      this.sendEvent({ type: 'CANCEL' });
      return;
    }

    let apiKey = '';
    if (requiresApiKey) {
      clack.log.info(chalk.dim('ℹ️ Your API key will be hidden for security and saved to .env.local'));
      const apiKeyResult = await clack.password({
        message: 'Enter your WorkOS API Key:',
        validate: (value) => {
          if (!value || value.trim().length === 0) {
            return 'API Key is required';
          }
          if (!value.startsWith('sk_')) {
            return 'API Key should start with "sk_"';
          }
          return undefined;
        },
      });

      if (clack.isCancel(apiKeyResult)) {
        this.sendEvent({ type: 'CANCEL' });
        return;
      }
      apiKey = apiKeyResult as string;
    } else {
      clack.log.info(chalk.dim('ℹ️ Client-only SDK - API key not required'));
    }

    this.sendEvent({
      type: 'CREDENTIALS_SUBMITTED',
      apiKey,
      clientId: clientId as string,
    });
  };

  private handleConfigComplete = (): void => {
    clack.log.success('Environment configured');
  };

  private handleAgentStart = (): void => {
    this.hasAgentProgress = false;
    this.spinner = clack.spinner();
    this.spinner.start('Running AI agent...');

    // Periodic status updates for long-running operations
    let dots = 0;
    this.agentUpdateInterval = setInterval(() => {
      dots = (dots + 1) % 4;
      const dotStr = '.'.repeat(dots + 1);
      if (!this.hasAgentProgress) {
        this.spinner?.message(`Running AI agent${dotStr}`);
      }
    }, 2000);
  };

  private handleAgentProgress = ({ step, detail }: InstallerEvents['agent:progress']): void => {
    this.hasAgentProgress = true;
    const message = detail ? `${step}: ${detail}` : step;
    this.spinner?.message(message);
  };

  private handleValidationStart = (): void => {
    this.stopAgentUpdates();
    this.stopSpinner('Agent completed');
  };

  private handleValidationIssues = ({ issues }: InstallerEvents['validation:issues']): void => {
    for (const issue of issues) {
      if (issue.severity === 'error') {
        clack.log.error(issue.message);
      } else {
        clack.log.warn(issue.message);
      }
      if (issue.hint) {
        clack.log.info(`Hint: ${issue.hint}`);
      }
    }
  };

  private handleValidationComplete = ({ passed, issueCount }: InstallerEvents['validation:complete']): void => {
    if (passed) {
      clack.log.success('Validation passed');
    } else {
      clack.log.warn(`Validation found ${issueCount} issue(s)`);
    }
  };

  private handleComplete = ({ success, summary, product }: InstallerEvents['complete']): void => {
    this.stopAgentUpdates();
    this.stopSpinner(success ? 'Done' : 'Failed');

    if (success) {
      if (product === 'widgets') {
        clack.log.success('WorkOS Widgets installed!');
        if (summary) {
          clack.log.message(summary);
        } else {
          clack.log.message('Next steps:');
          clack.log.message('  • Start your dev server to test the user management page');
          clack.log.message('  • Visit WorkOS Dashboard to manage widgets and settings');
        }
        clack.outro(chalk.dim('Docs: https://workos.com/docs/widgets/quick-start'));
      } else {
        clack.log.success('WorkOS AuthKit installed!');
        clack.log.message('Next steps:');
        clack.log.message('  • Start dev server to test authentication');
        clack.log.message('  • Visit WorkOS Dashboard to manage users');
        clack.outro(chalk.dim('Docs: https://workos.com/docs/authkit'));
      }
    } else {
      clack.log.error('Installation failed');
      if (summary) {
        clack.log.info(summary);
      }
      clack.outro(chalk.dim('Report issues: https://github.com/workos/installer/issues'));
    }
  };

  private handleError = ({ message, stack }: InstallerEvents['error']): void => {
    this.stopSpinner('Error');
    this.stopAgentUpdates();

    clack.log.error(message);

    // Add actionable hints for common errors
    if (message.includes('authentication') || message.includes('auth')) {
      clack.log.info('Try running: workos logout && workos install');
    }
    if (message.includes('ENOENT') || message.includes('not found')) {
      clack.log.info('Ensure you are in a project directory');
    }

    if (stack && this.debug) {
      this.debugLog(stack);
    }
  };

  private handleBranchPrompt = async ({ branch }: InstallerEvents['branch:prompt']): Promise<void> => {
    this.isPromptActive = true;
    const choice = await clack.select({
      message: `You are on ${chalk.bold(branch)}. Create a feature branch?`,
      options: [
        { value: 'create', label: 'Create feat/add-workos-authkit' },
        { value: 'continue', label: 'Continue on current branch' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });
    this.isPromptActive = false;
    this.flushPendingLogs();

    if (clack.isCancel(choice) || choice === 'cancel') {
      this.sendEvent({ type: 'BRANCH_CANCEL' });
    } else if (choice === 'create') {
      this.sendEvent({ type: 'BRANCH_CREATE' });
    } else {
      this.sendEvent({ type: 'BRANCH_CONTINUE' });
    }
  };

  private handleBranchCreated = ({ branch }: InstallerEvents['branch:created']): void => {
    this.queueableLog(() => clack.log.success(`Created branch ${chalk.bold(branch)}`));
  };

  // ===== Post-install Event Handlers =====

  private handlePostInstallChanges = ({ files }: InstallerEvents['postinstall:changes']): void => {
    this.debugLog(`Post-install: ${files.length} changed files detected`);
  };

  private handleCommitPrompt = async (): Promise<void> => {
    this.isPromptActive = true;
    const confirmed = await clack.confirm({
      message: 'Commit the changes?',
      initialValue: true,
    });
    this.isPromptActive = false;
    this.flushPendingLogs();

    this.sendEvent({
      type: clack.isCancel(confirmed) || !confirmed ? 'COMMIT_DECLINED' : 'COMMIT_APPROVED',
    });
  };

  private handleCommitGenerating = (): void => {
    this.spinner = clack.spinner();
    this.spinner.start('Generating commit message...');
  };

  private handleCommitSuccess = ({ message }: InstallerEvents['postinstall:commit:success']): void => {
    this.stopSpinner('Committed');
    clack.log.success(`Committed: ${chalk.dim(message)}`);
  };

  private handleCommitFailed = ({ error }: InstallerEvents['postinstall:commit:failed']): void => {
    this.stopSpinner('Commit failed');
    clack.log.error(`Commit failed: ${error}`);
  };

  private handlePrPrompt = async (): Promise<void> => {
    this.isPromptActive = true;
    const confirmed = await clack.confirm({
      message: 'Create a pull request?',
      initialValue: true,
    });
    this.isPromptActive = false;
    this.flushPendingLogs();

    this.sendEvent({
      type: clack.isCancel(confirmed) || !confirmed ? 'PR_DECLINED' : 'PR_APPROVED',
    });
  };

  private handlePrGenerating = (): void => {
    this.spinner = clack.spinner();
    this.spinner.start('Generating PR description...');
  };

  private handlePrPushing = (): void => {
    if (this.spinner) {
      this.spinner.message('Pushing to remote...');
    } else {
      this.spinner = clack.spinner();
      this.spinner.start('Pushing to remote...');
    }
  };

  private handlePrSuccess = ({ url }: InstallerEvents['postinstall:pr:success']): void => {
    this.stopSpinner('PR created');
    clack.log.success(`Pull request created: ${chalk.cyan(url)}`);
  };

  private handlePrFailed = ({ error }: InstallerEvents['postinstall:pr:failed']): void => {
    this.stopSpinner('PR creation failed');
    clack.log.error(`PR creation failed: ${error}`);
  };

  private handlePushFailed = ({ error }: InstallerEvents['postinstall:push:failed']): void => {
    this.stopSpinner('Push failed');
    clack.log.error(`Push failed: ${error}`);
  };

  private handleManualInstructions = ({ instructions }: InstallerEvents['postinstall:manual']): void => {
    clack.log.info('GitHub CLI not found. Manual steps:');
    console.log(chalk.dim(instructions));
  };
}
