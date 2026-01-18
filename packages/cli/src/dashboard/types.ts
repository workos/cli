import type { WizardEventEmitter, WizardEvents } from '../lib/events.js';

export interface DashboardProps {
  emitter: WizardEventEmitter;
}

// Re-export for convenience
export type { WizardEvents, WizardEventEmitter };
