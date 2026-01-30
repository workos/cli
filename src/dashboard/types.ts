import type { InstallerEventEmitter, InstallerEvents } from '../lib/events.js';

export interface DashboardProps {
  emitter: InstallerEventEmitter;
}

// Re-export for convenience
export type { InstallerEvents, InstallerEventEmitter };
