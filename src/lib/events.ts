import { EventEmitter } from 'events';

/**
 * Structured data describing a successful installation, used to render the
 * completion summary and enrich the headless `complete` NDJSON event.
 *
 * Defined here (not in installer-core.types.ts) to avoid an import cycle:
 * installer-core.types.ts already imports from this module, so this module
 * must not import back.
 */
export interface CompletionData {
  /** Integration identifier (e.g. 'nextjs') */
  integration: string;
  /** Lockfile-aware dev command, e.g. "pnpm run dev" */
  devCommand: string;
  /** App URL with the detected port, e.g. "http://localhost:3000" */
  url: string;
  /** Changed files (git-relative), full list — display cap lives in the renderer */
  files: string[];
  /** Composed concrete + framework next-step lines */
  nextSteps: string[];
  /** Per-framework docs URL */
  docsUrl: string;
  /** WorkOS dashboard URL */
  dashboardUrl: string;
  /** Optional per-framework "add a sign-in link" snippet */
  signInSnippet?: string;
}

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
  complete: { success: boolean; summary?: string; completion?: CompletionData };
  /** `code` is set for structured declines (e.g. unsupported framework version); absent for unexpected failures. */
  error: { message: string; stack?: string; code?: string };

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
  'staging:success': { source?: 'device' | 'stored'; credentials?: { clientId: string; apiKey?: string } };
  'staging:error': { message: string; statusCode?: number };
  'config:start': Record<string, never>;
  'config:complete': Record<string, never>;
  'agent:start': Record<string, never>;
  'agent:progress': { step: string; detail?: string };
  'agent:success': { summary?: string };
  'agent:failure': { message: string; stack?: string };
  'agent:retry': { attempt: number; maxRetries: number };
  // Surfaced agent tool activity (e.g. Bash commands run during install)
  'agent:tool': { kind: 'command'; detail: string };

  'validation:retry:start': { attempt: number };
  'validation:retry:complete': { attempt: number; passed: boolean };

  'validation:start': { framework: string };
  'validation:issues': { issues: import('./validation/types.js').ValidationIssue[] };
  'validation:complete': { passed: boolean; issueCount: number; durationMs: number };

  // Scaffold events (empty-directory app scaffolding)
  'scaffold:checking': Record<string, never>;
  'scaffold:prompt': { packageManager: string };
  'scaffold:start': { packageManager: string };
  'scaffold:progress': { text: string };
  'scaffold:complete': Record<string, never>;
  'scaffold:failed': { error: string };
  'scaffold:skipped': Record<string, never>;

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
