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
  /** Saved application configuration is separate from untested browser flows. */
  applicationSetup?: import('./authkit-application-setup.js').AuthkitApplicationSetup;
}

/**
 * A WorkOS setting, named for the dashboard's AuthKit checklist ("Add
 * environment variables", "Set redirect URI", …).
 */
export type SetupItemId = 'env-vars' | 'redirect-uri' | 'initiate-login-uri' | 'sign-out-uri' | 'cors-origin';
/** `skipped`: not set, or not verified; `detail` says why and what to do. */
export type SetupItemStatus = 'started' | 'done' | 'already-set' | 'skipped' | 'failed';
export interface SetupItemEvent {
  step: SetupItemId;
  status: SetupItemStatus;
  detail?: string;
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
  /**
   * Credentials were already on `options` when the machine started. `source`
   * separates the two ways that happens — flags the user typed ('cli') versus a
   * pair `runWithCore` backfilled from the project's env file ('env') — because
   * the two need different copy, and the payload lets a listener check whether
   * the active profile is the one that supplied them.
   */
  'credentials:found': { source?: 'cli' | 'env'; credentials?: { clientId?: string; apiKey?: string } };
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
  /** A setting the configure step (before the agent) started or resolved. */
  'config:step': SetupItemEvent;
  /** An app URL set once the agent's routes exist (Next.js) started or resolved. */
  'app-urls:step': SetupItemEvent;
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

/**
 * Runtime list of every installer event name, for validating data that refers
 * to events by name (e.g. the full-screen installer's walkthrough copy).
 * `satisfies` makes the compiler reject a missing or unknown key, so this can't
 * drift from `InstallerEvents`.
 */
const INSTALLER_EVENT_REGISTRY = {
  status: true,
  output: true,
  'file:write': true,
  'file:edit': true,
  'prompt:request': true,
  'prompt:response': true,
  'confirm:request': true,
  'confirm:response': true,
  'credentials:request': true,
  'credentials:response': true,
  complete: true,
  error: true,
  'state:enter': true,
  'state:exit': true,
  'auth:checking': true,
  'auth:required': true,
  'auth:success': true,
  'auth:failure': true,
  'detection:start': true,
  'detection:complete': true,
  'detection:none': true,
  'git:checking': true,
  'git:clean': true,
  'git:dirty': true,
  'git:dirty:confirmed': true,
  'git:dirty:cancelled': true,
  'credentials:gathering': true,
  'credentials:found': true,
  'credentials:env:detected': true,
  'credentials:env:prompt': true,
  'credentials:env:scanning': true,
  'credentials:env:found': true,
  'credentials:env:notfound': true,
  'device:started': true,
  'device:polling': true,
  'device:success': true,
  'device:timeout': true,
  'device:error': true,
  'staging:fetching': true,
  'staging:success': true,
  'staging:error': true,
  'config:start': true,
  'config:complete': true,
  'config:step': true,
  'app-urls:step': true,
  'agent:start': true,
  'agent:progress': true,
  'agent:success': true,
  'agent:failure': true,
  'agent:retry': true,
  'agent:tool': true,
  'validation:retry:start': true,
  'validation:retry:complete': true,
  'validation:start': true,
  'validation:issues': true,
  'validation:complete': true,
  'scaffold:checking': true,
  'scaffold:prompt': true,
  'scaffold:start': true,
  'scaffold:progress': true,
  'scaffold:complete': true,
  'scaffold:failed': true,
  'scaffold:skipped': true,
  'branch:checking': true,
  'branch:protected': true,
  'branch:prompt': true,
  'branch:created': true,
  'branch:create:failed': true,
  'branch:skipped': true,
  'postinstall:changes': true,
  'postinstall:nochanges': true,
  'postinstall:commit:prompt': true,
  'postinstall:commit:generating': true,
  'postinstall:commit:committing': true,
  'postinstall:commit:success': true,
  'postinstall:commit:failed': true,
  'postinstall:pr:prompt': true,
  'postinstall:pr:generating': true,
  'postinstall:pr:pushing': true,
  'postinstall:pr:creating': true,
  'postinstall:pr:success': true,
  'postinstall:pr:failed': true,
  'postinstall:push:failed': true,
  'postinstall:manual': true,
} as const satisfies Record<InstallerEventName, true>;

export const INSTALLER_EVENT_NAMES = Object.keys(INSTALLER_EVENT_REGISTRY) as InstallerEventName[];

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
