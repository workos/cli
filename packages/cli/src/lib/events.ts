import { EventEmitter } from 'events';

// Event payload types
export interface WizardEvents {
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
}

export type WizardEventName = keyof WizardEvents;

export class WizardEventEmitter extends EventEmitter {
  emit<K extends WizardEventName>(event: K, payload: WizardEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends WizardEventName>(
    event: K,
    listener: (payload: WizardEvents[K]) => void,
  ): this {
    return super.on(event, listener);
  }

  off<K extends WizardEventName>(
    event: K,
    listener: (payload: WizardEvents[K]) => void,
  ): this {
    return super.off(event, listener);
  }
}

// Factory function for easy creation
export function createWizardEventEmitter(): WizardEventEmitter {
  return new WizardEventEmitter();
}
