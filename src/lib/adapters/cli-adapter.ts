import type { WizardAdapter, AdapterConfig } from './types.js';
import type { WizardEventEmitter, WizardEvents } from '../events.js';
import clack from '../../utils/clack.js';
import chalk from 'chalk';
import { getConfig } from '../settings.js';
import { ProgressTracker } from '../progress-tracker.js';
import { styled } from '../../utils/cli-symbols.js';

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
  private progress = new ProgressTracker();

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
      const art = config.branding.useCompact ? config.branding.compactAsciiArt : config.branding.asciiArt;
      console.log(chalk.cyan(art));
      console.log();
    } else {
      clack.intro('Welcome to the WorkOS AuthKit setup wizard');
    }

    // Subscribe to state events for progress tracking
    this.subscribe('state:enter', this.handleStateEnter);
    this.subscribe('state:exit', this.handleStateExit);

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
    this.subscribe('config:start', this.handleConfigStart);
    this.subscribe('config:complete', this.handleConfigComplete);
    this.subscribe('agent:start', this.handleAgentStart);
    this.subscribe('agent:progress', this.handleAgentProgress);
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

  private handleStateEnter = ({ state }: WizardEvents['state:enter']): void => {
    this.progress.enterPhase(state);
    const indicator = this.progress.getCurrentIndicator();
    if (indicator) {
      clack.log.step(chalk.cyan(indicator));
    }
  };

  private handleStateExit = ({ state }: WizardEvents['state:exit']): void => {
    this.progress.exitPhase(state);
  };

  private handleAuthChecking = (): void => {
    // Progress tracker shows phase, minimal output needed
  };

  private handleAuthRequired = (): void => {
    // Progress tracker shows phase, minimal output needed
  };

  private handleAuthSuccess = (): void => {
    console.log(styled.success('Authenticated'));
  };

  private handleAuthFailure = ({ message }: WizardEvents['auth:failure']): void => {
    console.log(styled.error(`Authentication failed: ${message}`));
  };

  private handleDetectionStart = (): void => {
    // Progress tracker shows phase, no-op here
  };

  private handleDetectionComplete = ({ integration }: WizardEvents['detection:complete']): void => {
    this.queueableLog(() => console.log(styled.success(`Detected ${chalk.bold(integration)}`)));
  };

  private handleDetectionNone = (): void => {
    this.queueableLog(() => console.log(styled.warning('Could not detect framework automatically')));
  };

  private handleGitChecking = (): void => {
    // Silent - don't clutter output
  };

  private handleGitClean = (): void => {
    // Silent - don't clutter output
  };

  private handleCredentialsFound = (): void => {
    console.log(styled.success('Found existing WorkOS credentials in .env.local'));
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
    // Progress tracker shows phase, minimal output needed
  };

  private handleConfigComplete = (): void => {
    console.log(styled.success('Environment configured'));
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
    // Progress tracker shows phase, minimal output needed
  };

  private handleValidationIssues = ({ issues }: WizardEvents['validation:issues']): void => {
    for (const issue of issues) {
      if (issue.severity === 'error') {
        console.log(styled.error(issue.message));
      } else {
        console.log(styled.warning(issue.message));
      }
      if (issue.hint) {
        console.log(styled.info(`Hint: ${issue.hint}`));
      }
    }
  };

  private handleValidationComplete = ({ passed, issueCount }: WizardEvents['validation:complete']): void => {
    if (passed) {
      console.log(styled.success('Validation passed'));
    } else {
      console.log(styled.warning(`Validation found ${issueCount} issue(s)`));
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
}
