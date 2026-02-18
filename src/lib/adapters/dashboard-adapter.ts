import type { InstallerAdapter, AdapterConfig } from './types.js';
import type { InstallerEventEmitter, InstallerEvents } from '../events.js';
import { renderCompletionSummary } from '../../utils/summary-box.js';

/**
 * Dashboard adapter that renders wizard events via Ink/React TUI.
 *
 * Wraps the existing Dashboard component and passes the emitter to it.
 * The Dashboard component already handles most event rendering internally.
 */
export class DashboardAdapter implements InstallerAdapter {
  readonly emitter: InstallerEventEmitter;
  private sendEvent: AdapterConfig['sendEvent'];
  private cleanup: (() => void) | null = null;
  private isStarted = false;
  private completionData: { success: boolean; summary?: string } | null = null;

  constructor(config: AdapterConfig) {
    this.emitter = config.emitter;
    this.sendEvent = config.sendEvent;
  }

  async start(): Promise<void> {
    if (this.isStarted) return;
    this.isStarted = true;

    // Dynamic imports to avoid loading Ink when not needed
    const { render } = await import('ink');
    const { createElement } = await import('react');
    const { Dashboard } = await import('../../dashboard/components/Dashboard.js');

    // Enter fullscreen (alternate screen buffer)
    process.stdout.write('\x1b[?1049h'); // Enter alternate screen
    process.stdout.write('\x1b[2J'); // Clear entire screen
    process.stdout.write('\x1b[H'); // Move cursor to home
    process.stdout.write('\x1b[?25l'); // Hide cursor

    // Render the Dashboard component with emitter
    const instance = render(createElement(Dashboard, { emitter: this.emitter }));

    // Setup cleanup function
    this.cleanup = () => {
      instance.unmount();
      process.stdout.write('\x1b[?25h'); // Show cursor
      process.stdout.write('\x1b[?1049l'); // Exit alternate screen
    };

    // Wire up Dashboard responses back to the machine
    // The Dashboard component emits these when user interacts
    this.emitter.on('confirm:response', this.handleConfirmResponse);
    this.emitter.on('credentials:response', this.handleCredentialsResponse);

    // Track completion for post-exit summary
    this.emitter.on('complete', this.handleComplete);
  }

  /**
   * Capture completion data for display after exit.
   */
  private handleComplete = ({ success, summary }: InstallerEvents['complete']): void => {
    this.completionData = { success, summary };
  };

  async stop(): Promise<void> {
    if (!this.isStarted) return;

    // Unsubscribe from events
    this.emitter.off('confirm:response', this.handleConfirmResponse);
    this.emitter.off('credentials:response', this.handleCredentialsResponse);
    this.emitter.off('complete', this.handleComplete);

    // Run cleanup (unmount Ink, exit fullscreen)
    this.cleanup?.();
    this.cleanup = null;

    if (this.completionData) {
      console.log();
      console.log(renderCompletionSummary(this.completionData.success, this.completionData.summary));
      console.log();
    }

    this.isStarted = false;
  }

  /**
   * Handle confirm dialog responses from Dashboard.
   */
  private handleConfirmResponse = ({ id, confirmed }: { id: string; confirmed: boolean }): void => {
    if (id === 'git-status') {
      this.sendEvent({ type: confirmed ? 'GIT_CONFIRMED' : 'GIT_CANCELLED' });
    } else if (id === 'env-scan') {
      this.sendEvent({ type: confirmed ? 'ENV_SCAN_APPROVED' : 'ENV_SCAN_DECLINED' });
    } else if (id === 'branch-check') {
      // For dashboard, confirmed=true means create branch, false means continue on current
      this.sendEvent({ type: confirmed ? 'BRANCH_CREATE' : 'BRANCH_CONTINUE' });
    } else if (id === 'commit') {
      this.sendEvent({ type: confirmed ? 'COMMIT_APPROVED' : 'COMMIT_DECLINED' });
    } else if (id === 'pr') {
      this.sendEvent({ type: confirmed ? 'PR_APPROVED' : 'PR_DECLINED' });
    }
  };

  /**
   * Handle credentials form submission from Dashboard.
   */
  private handleCredentialsResponse = ({ apiKey, clientId }: { apiKey: string; clientId: string }): void => {
    this.sendEvent({ type: 'CREDENTIALS_SUBMITTED', apiKey, clientId });
  };
}
