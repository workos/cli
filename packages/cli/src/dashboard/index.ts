import type { WizardEventEmitter } from '../lib/events.js';

export interface DashboardOptions {
  emitter: WizardEventEmitter;
}

let cleanup: (() => void) | null = null;
let isRunning = false;

// Enter alternate screen buffer for fullscreen TUI
function enterFullscreen(): void {
  process.stdout.write('\x1b[?1049h'); // Enter alternate screen
  process.stdout.write('\x1b[2J'); // Clear entire screen
  process.stdout.write('\x1b[H'); // Move cursor to home position
  process.stdout.write('\x1b[?25l'); // Hide cursor
}

// Exit alternate screen buffer
function exitFullscreen(): void {
  process.stdout.write('\x1b[?25h'); // Show cursor
  process.stdout.write('\x1b[?1049l'); // Exit alternate screen
}

export async function startDashboard(options: DashboardOptions): Promise<void> {
  if (isRunning) return; // Prevent double initialization
  isRunning = true;

  const { render } = await import('ink');
  const { createElement } = await import('react');
  const { Dashboard } = await import('./components/Dashboard.js');

  enterFullscreen();

  // Disable Ink's automatic Ctrl+C handling so our SIGINT handler in run-with-core.ts
  // can properly flush telemetry before exit
  const instance = render(createElement(Dashboard, { emitter: options.emitter }), {
    exitOnCtrlC: false,
  });
  cleanup = () => {
    instance.unmount();
    exitFullscreen();
    isRunning = false;
  };
}

export async function stopDashboard(): Promise<void> {
  cleanup?.();
  cleanup = null;
}
