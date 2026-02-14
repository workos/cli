import { EventEmitter } from 'events';

export interface InstallerEvents {
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
  // Credential discovery events
  'credentials:env:detected': { files: string[] };
  'credentials:env:prompt': { files: string[] };
  'credentials:env:scanning': Record<string, never>;
  'credentials:env:found': { sourcePath: string };
  'credentials:env:notfound': Record<string, never>;
  // Device auth events
  'device:started': { verificationUri: string; verificationUriComplete: string; userCode: string };
  'device:polling': Record<string, never>;
  'device:success': { email?: string };
  'device:timeout': Record<string, never>;
  'device:error': { message: string };
  // Staging API events
  'staging:fetching': Record<string, never>;
  'staging:success': Record<string, never>;
  'staging:error': { message: string; statusCode?: number };
  'config:start': Record<string, never>;
  'config:complete': Record<string, never>;
  'agent:start': Record<string, never>;
  'agent:progress': { step: string; detail?: string };
  'agent:success': { summary?: string };
  'agent:failure': { message: string; stack?: string };

  'validation:quick:start': Record<string, never>;
  'validation:quick:complete': {
    passed: boolean;
    results: import('./validation/types.js').QuickCheckResult[];
    durationMs: number;
  };

  'validation:start': { framework: string };
  'validation:issues': { issues: import('./validation/types.js').ValidationIssue[] };
  'validation:complete': { passed: boolean; issueCount: number; durationMs: number };

  // Branch check events
  'branch:checking': Record<string, never>;
  'branch:protected': { branch: string };
  'branch:prompt': { branch: string };
  'branch:created': { branch: string };
  'branch:create:failed': { error: string };
  'branch:skipped': Record<string, never>;

  // Post-install events
  'postinstall:changes': { files: string[] };
  'postinstall:nochanges': Record<string, never>;
  'postinstall:commit:prompt': Record<string, never>;
  'postinstall:commit:generating': Record<string, never>;
  'postinstall:commit:committing': { message: string };
  'postinstall:commit:success': { message: string };
  'postinstall:commit:failed': { error: string };
  'postinstall:pr:prompt': Record<string, never>;
  'postinstall:pr:generating': Record<string, never>;
  'postinstall:pr:pushing': Record<string, never>;
  'postinstall:pr:creating': Record<string, never>;
  'postinstall:pr:success': { url: string };
  'postinstall:pr:failed': { error: string };
  'postinstall:push:failed': { error: string };
  'postinstall:manual': { instructions: string };
}

export type InstallerEventName = keyof InstallerEvents;

export class InstallerEventEmitter extends EventEmitter {
  emit<K extends InstallerEventName>(event: K, payload: InstallerEvents[K]): boolean {
    return super.emit(event, payload);
  }

  on<K extends InstallerEventName>(event: K, listener: (payload: InstallerEvents[K]) => void): this {
    return super.on(event, listener);
  }

  off<K extends InstallerEventName>(event: K, listener: (payload: InstallerEvents[K]) => void): this {
    return super.off(event, listener);
  }

  once<K extends InstallerEventName>(event: K, listener: (payload: InstallerEvents[K]) => void): this {
    return super.once(event, listener);
  }
}

export function createInstallerEventEmitter(): InstallerEventEmitter {
  return new InstallerEventEmitter();
}
