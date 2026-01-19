import type { WizardAdapter, AdapterConfig } from './types.js';
import type { WizardEventEmitter, WizardEvents } from '../events.js';
import clack from '../../utils/clack.js';
import chalk from 'chalk';
import { getSettings } from '../settings.js';

/**
 * CLI adapter that renders wizard events via clack.
 *
 * Subscribes to WizardEventEmitter and translates events into
 * clack UI operations (logs, spinners, prompts).
 */
export class CLIAdapter implements WizardAdapter {
  readonly emitter: WizardEventEmitter;
  private sendEvent: AdapterConfig['sendEvent'];
  private spinner: ReturnType<typeof clack.spinner> | null = null;
  private isStarted = false;

  // Store bound handlers for cleanup
  private handlers = new Map<string, (...args: unknown[]) => void>();

  constructor(config: AdapterConfig) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    // Show intro
    const settings = getSettings();
    if (settings.branding.showAsciiArt) {
      console.log(chalk.cyan(settings.branding.asciiArt));
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
    this.subscribe('credentials:request', this.handleCredentialsRequest);
    this.subscribe('config:start', this.handleConfigStart);
    this.subscribe('config:complete', this.handleConfigComplete);
    this.subscribe('agent:start', this.handleAgentStart);
    this.subscribe('agent:progress', this.handleAgentProgress);
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
    clack.log.step('Detecting framework...');
  };

  private handleDetectionComplete = ({ integration }: WizardEvents['detection:complete']): void => {
    clack.log.success(`Detected: ${integration}`);
  };

  private handleDetectionNone = (): void => {
    clack.log.warn('Could not detect framework automatically');
  };

  private handleGitChecking = (): void => {
    // Silent - don't clutter output
  };

  private handleGitClean = (): void => {
    // Silent - don't clutter output
  };

  private handleGitDirty = async ({ files }: WizardEvents['git:dirty']): Promise<void> => {
    clack.log.warn('You have uncommitted or untracked files:');
    files.slice(0, 5).forEach((f) => clack.log.info(chalk.dim(`  ${f}`)));
    if (files.length > 5) {
      clack.log.info(chalk.dim(`  ... and ${files.length - 5} more`));
    }

    const confirmed = await clack.confirm({
      message: 'Continue anyway?',
      initialValue: false,
    });

    if (clack.isCancel(confirmed)) {
      this.sendEvent({ type: 'GIT_CANCELLED' });
    } else if (confirmed) {
      this.sendEvent({ type: 'GIT_CONFIRMED' });
    } else {
      this.sendEvent({ type: 'GIT_CANCELLED' });
    }
  };

  private handleCredentialsRequest = async ({ requiresApiKey }: WizardEvents['credentials:request']): Promise<void> => {
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
      const apiKeyResult = await clack.text({
        message: 'Enter your WorkOS API Key:',
        placeholder: 'sk_...',
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
    if (stack && process.env.DEBUG) {
      console.error(chalk.dim(stack));
    }
  };
}
