import type { WizardAdapter, AdapterConfig } from './types.js';
import type { WizardEventEmitter, WizardEvents } from '../events.js';
import clack from '../../utils/clack.js';
import chalk from 'chalk';
import { getConfig } from '../settings.js';

/**
 * CLI adapter that renders wizard events via clack.
 *
 * Subscribes to WizardEventEmitter and translates events into
 * clack UI operations (logs, spinners, prompts).
 */
export class CLIAdapter implements WizardAdapter {
  readonly emitter: WizardEventEmitter;
  private sendEvent: AdapterConfig['sendEvent'];
  private debug: boolean;
  private spinner: ReturnType<typeof clack.spinner> | null = null;
  private isStarted = false;

  // Store bound handlers for cleanup
  private handlers = new Map<string, (...args: unknown[]) => void>();

  // Queue for logs while prompt is active (parallel state issue)
  private isPromptActive = false;
  private pendingLogs: Array<() => void> = [];

  constructor(config: AdapterConfig) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
    this.debug = config.debug ?? false;
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
      console.log(chalk.cyan(config.branding.asciiArt));
      console.log();
    } else {
      clack.intro('Welcome to the WorkOS AuthKit setup wizard');
    }

    // Subscribe to all events
    this.subscribe('auth:checking', this.handleAuthChecking);
    this.subscribe('auth:required', this.handleAuthRequired);
    this.subscribe('auth:success', this.handleAuthSuccess);
    this.subscribe('auth:failure', this.handleAuthFailure);
    this.subscribe('detection:start', this.handleDetectionStart);
    this.subscribe('detection:complete', this.handleDetectionComplete);
    this.subscribe('detection:none', this.handleDetectionNone);
    this.subscribe('git:checking', this.handleGitChecking);
    this.subscribe('git:clean', this.handleGitClean);
    this.subscribe('git:dirty', this.handleGitDirty);
    this.subscribe('credentials:found', this.handleCredentialsFound);
    this.subscribe('credentials:request', this.handleCredentialsRequest);
    this.subscribe('credentials:env:prompt', this.handleEnvScanPrompt);
    this.subscribe('credentials:env:scanning', this.handleEnvScanning);
    this.subscribe('credentials:env:found', this.handleEnvCredentialsFound);
    this.subscribe('device:started', this.handleDeviceStarted);
    this.subscribe('device:polling', this.handleDevicePolling);
    this.subscribe('device:success', this.handleDeviceSuccess);
    this.subscribe('device:error', this.handleDeviceError);
    this.subscribe('staging:fetching', this.handleStagingFetching);
    this.subscribe('staging:success', this.handleStagingSuccess);
    this.subscribe('staging:error', this.handleStagingError);
    this.subscribe('config:start', this.handleConfigStart);
    this.subscribe('config:complete', this.handleConfigComplete);
    this.subscribe('agent:start', this.handleAgentStart);
    this.subscribe('agent:progress', this.handleAgentProgress);
    this.subscribe('agent:failure', this.handleAgentFailure);
    this.subscribe('validation:start', this.handleValidationStart);
    this.subscribe('validation:issues', this.handleValidationIssues);
    this.subscribe('validation:complete', this.handleValidationComplete);
    this.subscribe('complete', this.handleComplete);
    this.subscribe('error', this.handleError);
  }

  async stop(): Promise<void> {
    if (!this.isStarted) return;

    // Unsubscribe from all events
    for (const [event, handler] of this.handlers) {
      this.emitter.off(event as keyof WizardEvents, handler as never);
    }
    this.handlers.clear();

    // Stop any active spinner
    this.spinner?.stop();
    this.spinner = null;

    this.isStarted = false;
  }

  /**
   * Helper to subscribe and track handlers for cleanup.
   */
  private subscribe<K extends keyof WizardEvents>(
    event: K,
    handler: (payload: WizardEvents[K]) => void | Promise<void>,
  ): void {
    const boundHandler = handler.bind(this);
    this.handlers.set(event, boundHandler as (...args: unknown[]) => void);
    this.emitter.on(event, boundHandler);
  }

  // ===== Event Handlers =====

  private handleAuthChecking = (): void => {
    clack.log.step('Checking authentication...');
  };

  private handleAuthRequired = (): void => {
    clack.log.step('Authentication required');
  };

  private handleAuthSuccess = (): void => {
    clack.log.success('Authenticated');
  };

  private handleAuthFailure = ({ message }: WizardEvents['auth:failure']): void => {
    clack.log.error(`Authentication failed: ${message}`);
  };

  private handleDetectionStart = (): void => {
    this.queueableLog(() => clack.log.step('Detecting framework...'));
  };

  private handleDetectionComplete = ({ integration }: WizardEvents['detection:complete']): void => {
    this.queueableLog(() => clack.log.success(`Detected: ${integration}`));
  };

  private handleDetectionNone = (): void => {
    this.queueableLog(() => clack.log.warn('Could not detect framework automatically'));
  };

  private handleGitChecking = (): void => {
    // Silent - don't clutter output
  };

  private handleGitClean = (): void => {
    // Silent - don't clutter output
  };

  private handleCredentialsFound = (): void => {
    clack.log.success('Found existing WorkOS credentials in .env.local');
  };

  private handleGitDirty = async ({ files }: WizardEvents['git:dirty']): Promise<void> => {
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

    if (clack.isCancel(confirmed)) {
      this.sendEvent({ type: 'GIT_CANCELLED' });
    } else if (confirmed) {
      this.sendEvent({ type: 'GIT_CONFIRMED' });
    } else {
      this.sendEvent({ type: 'GIT_CANCELLED' });
    }
  };

  private handleCredentialsRequest = async ({ requiresApiKey }: WizardEvents['credentials:request']): Promise<void> => {
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

  private handleConfigStart = (): void => {
    clack.log.step('Configuring environment...');
  };

  private handleConfigComplete = (): void => {
    clack.log.success('Environment configured');
  };

  private handleAgentStart = (): void => {
    this.spinner = clack.spinner();
    this.spinner.start('Running AI agent...');
  };

  private handleAgentProgress = ({ step, detail }: WizardEvents['agent:progress']): void => {
    const message = detail ? `${step}: ${detail}` : step;
    this.spinner?.message(message);
  };

  private handleValidationStart = (): void => {
    if (this.spinner) {
      this.spinner.stop('Agent completed');
      this.spinner = null;
    }
    clack.log.step('Validating installation...');
  };

  private handleValidationIssues = ({ issues }: WizardEvents['validation:issues']): void => {
    for (const issue of issues) {
      const prefix = issue.severity === 'error' ? '!' : '?';
      clack.log.warn(`${prefix} ${issue.message}`);
      if (issue.hint) {
        clack.log.info(chalk.dim(`  Hint: ${issue.hint}`));
      }
    }
  };

  private handleValidationComplete = ({ passed, issueCount }: WizardEvents['validation:complete']): void => {
    if (passed) {
      clack.log.success('Validation passed');
    } else {
      clack.log.warn(`Validation found ${issueCount} issue(s)`);
    }
  };

  private handleComplete = ({ success, summary }: WizardEvents['complete']): void => {
    if (this.spinner) {
      this.spinner.stop(success ? 'Agent completed' : 'Agent failed');
      this.spinner = null;
    }

    if (success) {
      if (summary) {
        clack.outro(summary);
      } else {
        clack.outro('WorkOS AuthKit integration complete!');
      }
    } else {
      clack.log.error(summary ?? 'Wizard failed');
    }
  };

  private handleAgentFailure = ({ message, stack }: WizardEvents['agent:failure']): void => {
    if (this.spinner) {
      this.spinner.stop('Agent failed');
      this.spinner = null;
    }

    clack.log.error(`Agent error: ${message}`);
    if (stack && this.debug) {
      console.error(chalk.dim(stack));
    }
  };

  private handleError = ({ message, stack }: WizardEvents['error']): void => {
    if (this.spinner) {
      this.spinner.stop('Error');
      this.spinner = null;
    }

    clack.log.error(message);
    if (stack && this.debug) {
      console.error(chalk.dim(stack));
    }
  };

  // ===== Credential Resolution Handlers =====

  private handleEnvScanPrompt = async ({ files }: WizardEvents['credentials:env:prompt']): Promise<void> => {
    const fileList = files.join(', ');
    this.isPromptActive = true;
    const approved = await clack.confirm({
      message: `Found ${fileList}. Check for existing WorkOS credentials?`,
      initialValue: true,
    });
    this.isPromptActive = false;
    this.flushPendingLogs();

    if (clack.isCancel(approved)) {
      this.sendEvent({ type: 'ENV_SCAN_DECLINED' });
    } else {
      this.sendEvent({ type: approved ? 'ENV_SCAN_APPROVED' : 'ENV_SCAN_DECLINED' });
    }
  };

  private handleEnvScanning = (): void => {
    clack.log.step('Scanning for WorkOS credentials...');
  };

  private handleEnvCredentialsFound = ({ source, hasApiKey }: WizardEvents['credentials:env:found']): void => {
    const msg = hasApiKey
      ? `Found credentials in ${source}`
      : `Found Client ID in ${source} (no API key)`;
    clack.log.success(msg);
  };

  private handleDeviceStarted = ({ verificationUri, userCode }: WizardEvents['device:started']): void => {
    clack.log.info(`\nOpen this URL in your browser:\n  ${chalk.cyan(verificationUri)}`);
    clack.log.info(`Enter code: ${chalk.bold(userCode)}\n`);
    this.spinner = clack.spinner();
    this.spinner.start('Waiting for authorization...');
  };

  private handleDevicePolling = (): void => {
    // Just keep spinner going, no message change needed
  };

  private handleDeviceSuccess = (): void => {
    if (this.spinner) {
      this.spinner.stop('Authorized');
      this.spinner = null;
    }
    clack.log.success('Successfully authenticated');
  };

  private handleDeviceError = ({ message }: WizardEvents['device:error']): void => {
    if (this.spinner) {
      this.spinner.stop('Failed');
      this.spinner = null;
    }
    clack.log.error(`Device authorization failed: ${message}`);
  };

  private handleStagingFetching = (): void => {
    clack.log.step('Fetching your WorkOS credentials...');
  };

  private handleStagingSuccess = (): void => {
    clack.log.success('Retrieved staging credentials');
  };

  private handleStagingError = ({ message }: WizardEvents['staging:error']): void => {
    clack.log.error(`Failed to fetch credentials: ${message}`);
  };
}
