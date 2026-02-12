import type { InstallerEventEmitter } from '../events.js';

/**
 * Configuration passed to adapter constructors.
 */
export interface AdapterConfig {
  /** Event emitter to subscribe to */
  emitter: InstallerEventEmitter;

  /**
   * Callback to send events back to the machine.
   * Used for user responses (confirmations, credentials, etc.)
   */
  sendEvent: (event: { type: string; [key: string]: unknown }) => void;

  /** Enable verbose debug output (stack traces, etc.) */
  debug?: boolean;

  /** Optional product name override for messaging */
  productName?: string;
}

/**
 * Interface all UI adapters must implement.
 *
 * Adapters are event subscribers that translate machine events
 * into framework-specific UI rendering. They don't control flow—
 * they react to it.
 */
export interface InstallerAdapter {
  /**
   * Start the adapter.
   * - Subscribe to emitter events
   * - Initialize UI framework (show intro, enter fullscreen, etc.)
   */
  start(): Promise<void>;

  /**
   * Stop the adapter.
   * - Unsubscribe from all events
   * - Clean up UI (exit fullscreen, restore terminal, etc.)
   */
  stop(): Promise<void>;

  /** The emitter this adapter subscribes to */
  readonly emitter: InstallerEventEmitter;
}
