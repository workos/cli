import { EventEmitter } from 'events';

// Event payload types - EXPANDED for headless core
export interface WizardEvents {
  // ===== EXISTING EVENTS (keep as-is) =====
  status: { message: string };
  output: { text: string; isError?: boolean };
  'file:write': { path: string; content: string };
  'file:edit': { path: string; oldContent: string; newContent: string };
  'prompt:request': { id: string; message: string; options?: string[] };
  'prompt:response': { id: string; value: string };
  'confirm:request': { id: string; message: string; warning?: string; files?: string[] };
  'confirm:response': { id: string; confirmed: boolean };
  'credentials:request': { requiresApiKey: boolean };
  'credentials:response': { apiKey: string; clientId: string };
  complete: { success: boolean; summary?: string };
  error: { message: string; stack?: string };

  // ===== NEW: State lifecycle events =====
  /** Emitted when machine enters a new state */
  'state:enter': { state: string };
  /** Emitted when machine exits a state */
  'state:exit': { state: string };

  // ===== NEW: Authentication events =====
  /** Auth check is starting */
  'auth:checking': Record<string, never>;
  /** User needs to authenticate */
  'auth:required': Record<string, never>;
  /** Authentication succeeded */
  'auth:success': Record<string, never>;
  /** Authentication failed */
  'auth:failure': { message: string };

  // ===== NEW: Detection events =====
  /** Framework detection starting */
  'detection:start': Record<string, never>;
  /** Framework detected successfully */
  'detection:complete': { integration: string };
  /** No framework detected (user must select) */
  'detection:none': Record<string, never>;

  // ===== NEW: Git events =====
  /** Checking git status */
  'git:checking': Record<string, never>;
  /** Git working directory is clean */
  'git:clean': Record<string, never>;
  /** Git has uncommitted changes, awaiting user confirmation */
  'git:dirty': { files: string[] };
  /** User confirmed continuing with dirty git */
  'git:dirty:confirmed': Record<string, never>;
  /** User cancelled due to dirty git */
  'git:dirty:cancelled': Record<string, never>;

  // ===== NEW: Credentials events =====
  /** Credentials are being gathered */
  'credentials:gathering': { requiresApiKey: boolean };

  // ===== NEW: Configuration events =====
  /** Environment configuration starting */
  'config:start': Record<string, never>;
  /** Environment configuration complete */
  'config:complete': Record<string, never>;

  // ===== NEW: Agent events =====
  /** Agent execution starting */
  'agent:start': Record<string, never>;
  /** Agent progress update */
  'agent:progress': { step: string; detail?: string };
  /** Agent completed successfully */
  'agent:success': { summary?: string };
  /** Agent failed */
  'agent:failure': { message: string; stack?: string };
}

export type WizardEventName = keyof WizardEvents;

export class WizardEventEmitter extends EventEmitter {
  emit<K extends WizardEventName>(event: K, payload: WizardEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends WizardEventName>(event: K, listener: (payload: WizardEvents[K]) => void): this {
    return super.on(event, listener);
  }

  off<K extends WizardEventName>(event: K, listener: (payload: WizardEvents[K]) => void): this {
    return super.off(event, listener);
  }

  once<K extends WizardEventName>(event: K, listener: (payload: WizardEvents[K]) => void): this {
    return super.once(event, listener);
  }
}

// Factory function for easy creation
export function createWizardEventEmitter(): WizardEventEmitter {
  return new WizardEventEmitter();
}
