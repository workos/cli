import { EventEmitter } from 'events';

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

  'state:enter': { state: string };
  'state:exit': { state: string };
  'auth:checking': Record<string, never>;
  'auth:required': Record<string, never>;
  'auth:success': Record<string, never>;
  'auth:failure': { message: string };
  'detection:start': Record<string, never>;
  'detection:complete': { integration: string };
  'detection:none': Record<string, never>;
  'git:checking': Record<string, never>;
  'git:clean': Record<string, never>;
  'git:dirty': { files: string[] };
  'git:dirty:confirmed': Record<string, never>;
  'git:dirty:cancelled': Record<string, never>;
  'credentials:gathering': { requiresApiKey: boolean };
  'credentials:found': Record<string, never>;
  'config:start': Record<string, never>;
  'config:complete': Record<string, never>;
  'agent:start': Record<string, never>;
  'agent:progress': { step: string; detail?: string };
  'agent:success': { summary?: string };
  'agent:failure': { message: string; stack?: string };

  'validation:start': { framework: string };
  'validation:issues': { issues: import('./validation/types.js').ValidationIssue[] };
  'validation:complete': { passed: boolean; issueCount: number; durationMs: number };

  // Credential discovery events
  'credentials:env:detected': { files: string[] };
  'credentials:env:prompt': { files: string[] };
  'credentials:env:consent': { approved: boolean };
  'credentials:env:scanning': Record<string, never>;
  'credentials:env:found': { source: string; hasApiKey: boolean };
  'credentials:env:notfound': Record<string, never>;

  // Device authorization flow events
  'device:started': { verificationUri: string; userCode: string; verificationUriComplete: string };
  'device:polling': Record<string, never>;
  'device:slowdown': { newIntervalMs: number };
  'device:success': { email?: string };
  'device:timeout': Record<string, never>;
  'device:error': { message: string };

  // Staging credentials API events
  'staging:fetching': Record<string, never>;
  'staging:success': Record<string, never>;
  'staging:error': { message: string; statusCode?: number };
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

export function createWizardEventEmitter(): WizardEventEmitter {
  return new WizardEventEmitter();
}
