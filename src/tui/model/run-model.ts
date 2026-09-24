/**
 * Run model for the full-screen installer.
 *
 * A plain store over InstallerEventEmitter: it turns installer events into a
 * task list, a plain-English walkthrough, and the tips to show, and holds the
 * prompt the view should render. It has no Ink or React dependency, so it can
 * be driven by the real state machine in tests; the view reads it through
 * `useSyncExternalStore` (`subscribe` + `getSnapshot`).
 *
 * Progress comes only from real events. Nothing here advances on a timer.
 */

import type { EventEmitter } from 'node:events';
import { isAbsolute, relative } from 'node:path';
import type { InstallerEventEmitter, InstallerEventName, InstallerEvents } from '../../lib/events.js';
import type { UiPromptRequest } from '../../utils/ui.js';
import {
  TASK_IDS,
  frameworkName,
  selectAnnouncements,
  selectTips,
  walkthroughText,
  type Announcement,
  type InstallerContent,
  type TaskId,
  type Tip,
} from '../content/index.js';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'skipped' | 'failed' | 'cancelled';

export interface TaskView {
  id: TaskId;
  label: string;
  activeLabel?: string;
  status: TaskStatus;
}

export type EntryKind = 'narration' | 'status' | 'file' | 'command' | 'notice';
export type EntryTone = 'neutral' | 'success' | 'warning' | 'error';

export interface WalkthroughEntry {
  /** Stable, increasing key for rendering. */
  id: number;
  kind: EntryKind;
  tone: EntryTone;
  text: string;
}

export type RunOutcome = 'success' | 'failure' | 'cancelled';

export interface RunSnapshot {
  /** Tasks to display, in order. Optional tasks appear once they start. */
  tasks: TaskView[];
  walkthrough: WalkthroughEntry[];
  /** What's running right now (spinner text), if anything. */
  status: string | null;
  /** The prompt waiting on the user, if any. */
  prompt: UiPromptRequest | null;
  /** Detected integration id and its display name. */
  integration?: string;
  framework?: string;
  outcome: RunOutcome | null;
  tips: Tip[];
  announcements: Announcement[];
}

export interface RunModelOptions {
  emitter: InstallerEventEmitter;
  content: InstallerContent;
  /** Clock for announcement windows. */
  now?: Date;
  /** File paths are shown relative to this directory. */
  cwd?: string;
  /** Oldest walkthrough entries are dropped past this many. */
  maxEntries?: number;
}

export interface RunModel {
  subscribe(listener: () => void): () => void;
  getSnapshot(): RunSnapshot;
  setPrompt(prompt: UiPromptRequest | null): void;
  setStatus(message: string | null): void;
  /** Surface a warning or error the installer printed (e.g. a validation issue). */
  addNotice(tone: 'warning' | 'error', text: string): void;
  dispose(): void;
}

/** Machine phases (state:enter/exit ids) that own a task. */
const PHASE_TASKS: Record<string, TaskId> = {
  authenticating: 'sign-in',
  preparing: 'inspect',
  gatheringCredentials: 'credentials',
  configuring: 'configure',
  runningAgent: 'install',
  postInstall: 'finish',
};

/** Shown only once something starts them. */
const OPTIONAL_TASKS = new Set<TaskId>(['scaffold', 'verify']);

const TONES: Partial<Record<InstallerEventName, EntryTone>> = {
  'auth:success': 'success',
  'auth:failure': 'error',
  'scaffold:complete': 'success',
  'scaffold:failed': 'error',
  'detection:complete': 'success',
  'detection:none': 'warning',
  'git:dirty': 'warning',
  'branch:created': 'success',
  'credentials:env:found': 'success',
  'device:success': 'success',
  'staging:success': 'success',
  'config:complete': 'success',
  'agent:retry': 'warning',
  'agent:success': 'success',
  'agent:failure': 'error',
  'postinstall:commit:success': 'success',
  'postinstall:pr:success': 'success',
};

const MAX_COMMAND = 80;

export function createRunModel(options: RunModelOptions): RunModel {
  const { emitter, content } = options;
  const now = options.now ?? new Date();
  const cwd = options.cwd ?? process.cwd();
  const maxEntries = options.maxEntries ?? 300;

  const status = new Map<TaskId, TaskStatus>(TASK_IDS.map((id) => [id, 'pending']));
  const shown = new Set<TaskId>(TASK_IDS.filter((id) => !OPTIONAL_TASKS.has(id)));
  let walkthrough: WalkthroughEntry[] = [];
  let nextId = 1;
  let spinnerStatus: string | null = null;
  let prompt: UiPromptRequest | null = null;
  let integration: string | undefined;
  let outcome: RunOutcome | null = null;
  let cancelled = false;
  // The task whose phase just exited. Every exit is immediately followed by the
  // next state's enter, which settles it: completed, or failed/cancelled when
  // the machine went to error/cancelled instead. Settling there (not on exit)
  // keeps a failing task from flashing "completed" first.
  let exiting: TaskId | null = null;
  let lastFile: string | null = null;
  let lastProgress: string | null = null;

  const listeners = new Set<() => void>();
  let snapshot = build();

  function build(): RunSnapshot {
    const query = { framework: integration, now };
    return {
      tasks: TASK_IDS.filter((id) => shown.has(id)).map((id) => ({
        id,
        label: content.tasks[id].label,
        activeLabel: content.tasks[id].activeLabel,
        status: status.get(id)!,
      })),
      walkthrough,
      status: spinnerStatus,
      prompt,
      integration,
      framework: integration ? frameworkName(content, integration) : undefined,
      outcome,
      tips: selectTips(content, query),
      announcements: selectAnnouncements(content, query),
    };
  }

  function changed(): void {
    snapshot = build();
    for (const listener of listeners) listener();
  }

  function push(kind: EntryKind, tone: EntryTone, text: string): void {
    walkthrough = [...walkthrough, { id: nextId++, kind, tone, text }].slice(-maxEntries);
  }

  function narrate(
    event: InstallerEventName,
    params?: Record<string, string | number>,
    variant?: string,
    tone: EntryTone = TONES[event] ?? 'neutral',
  ): void {
    const text = walkthroughText(content, event, params, variant);
    if (text) push('narration', tone, text);
  }

  function setTask(id: TaskId, next: TaskStatus): void {
    shown.add(id);
    status.set(id, next);
  }

  function current(): TaskId | undefined {
    return TASK_IDS.find((id) => status.get(id) === 'in_progress');
  }

  function displayPath(path: string): string {
    if (!isAbsolute(path)) return path;
    const rel = relative(cwd, path);
    return rel && !rel.startsWith('..') ? rel : path;
  }

  // ── Phases → tasks ────────────────────────────────────────────────────────

  function onEnter({ state }: InstallerEvents['state:enter']): void {
    const ended = state === 'error' || state === 'cancelled';
    const settle: TaskStatus = state === 'error' ? 'failed' : state === 'cancelled' ? 'cancelled' : 'completed';
    const settling = exiting ?? (ended ? current() : undefined);
    exiting = null;
    if (settling) setTask(settling, settle);

    if (ended) {
      cancelled ||= state === 'cancelled';
      return;
    }
    if (state === 'complete') {
      for (const id of TASK_IDS) {
        const s = status.get(id);
        if (s === 'in_progress') setTask(id, 'completed');
        else if (s === 'pending') status.set(id, 'skipped');
      }
      return;
    }
    if (state === 'scaffold') {
      // --skip-auth goes straight here from idle.
      if (status.get('sign-in') === 'pending') status.set('sign-in', 'skipped');
      return;
    }
    const task = PHASE_TASKS[state];
    if (!task) return;
    // Anything still pending before this phase didn't run (e.g. sign-in with
    // --skip-auth).
    for (const id of TASK_IDS.slice(0, TASK_IDS.indexOf(task))) {
      if (status.get(id) === 'pending') status.set(id, 'skipped');
    }
    setTask(task, 'in_progress');
  }

  function onExit({ state }: InstallerEvents['state:exit']): void {
    const task: TaskId | undefined = state === 'scaffold' ? 'scaffold' : PHASE_TASKS[state];
    if (!task) return;
    // Validation runs inside the agent phase, so it ends when that phase does.
    const active = task === 'install' && status.get('verify') === 'in_progress' ? 'verify' : task;
    if (status.get(active) === 'in_progress') exiting = active;
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  type Handlers = { [K in InstallerEventName]?: (payload: InstallerEvents[K]) => void };
  const handlers: Handlers = {
    'state:enter': onEnter,
    'state:exit': onExit,

    'scaffold:prompt': () => {
      setTask('scaffold', 'in_progress');
      narrate('scaffold:prompt');
    },
    'scaffold:start': ({ packageManager }) => {
      setTask('scaffold', 'in_progress');
      narrate('scaffold:start', { packageManager });
    },

    'detection:complete': (payload) => {
      integration = payload.integration;
      narrate('detection:complete', { framework: frameworkName(content, payload.integration) });
    },
    'git:dirty': ({ files }) => narrate('git:dirty', { count: files.length }),
    'branch:protected': ({ branch }) => narrate('branch:protected', { branch }),
    'branch:created': ({ branch }) => narrate('branch:created', { branch }),
    'credentials:env:found': ({ sourcePath }) => narrate('credentials:env:found', { file: displayPath(sourcePath) }),
    'device:started': ({ verificationUriComplete, verificationUri, userCode }) =>
      narrate('device:started', { url: verificationUriComplete || verificationUri, code: userCode }),
    'agent:retry': ({ attempt, maxRetries }) => narrate('agent:retry', { attempt, maxRetries }),

    'agent:progress': ({ step, detail }) => {
      const text = detail ? `${step}: ${detail}` : step;
      if (text === lastProgress) return;
      lastProgress = text;
      push('status', 'neutral', text);
    },
    'file:write': ({ path }) => fileOp('file:write', path),
    'file:edit': ({ path }) => fileOp('file:edit', path),
    'agent:tool': ({ detail }) => {
      const command = detail.length > MAX_COMMAND ? `${detail.slice(0, MAX_COMMAND - 1)}…` : detail;
      const text = walkthroughText(content, 'agent:tool', { command });
      if (text) push('command', 'neutral', text);
    },

    'validation:start': () => {
      if (status.get('install') === 'in_progress') setTask('install', 'completed');
      setTask('verify', 'in_progress');
      narrate('validation:start');
    },
    'validation:complete': ({ passed, issueCount }) => {
      setTask('verify', 'completed');
      narrate(
        'validation:complete',
        { count: issueCount },
        passed ? 'passed' : 'failed',
        passed ? 'success' : 'warning',
      );
    },

    'postinstall:changes': ({ files }) => narrate('postinstall:changes', { count: files.length }),
    'postinstall:commit:success': ({ message }) => narrate('postinstall:commit:success', { message }),
    'postinstall:pr:success': ({ url }) => narrate('postinstall:pr:success', { url }),

    complete: ({ success }) => {
      outcome = success ? 'success' : cancelled ? 'cancelled' : 'failure';
      narrate(
        'complete',
        undefined,
        outcome,
        outcome === 'success' ? 'success' : outcome === 'cancelled' ? 'warning' : 'error',
      );
    },
  };

  function fileOp(event: 'file:write' | 'file:edit', path: string): void {
    if (path === lastFile) return;
    lastFile = path;
    const text = walkthroughText(content, event, { path: displayPath(path) });
    if (text) push('file', 'neutral', text);
  }

  // Every other event the content narrates takes no params.
  for (const event of Object.keys(content.walkthrough) as InstallerEventName[]) {
    if (!(event in handlers)) (handlers as Record<string, () => void>)[event] = () => narrate(event);
  }
  // Handlers are keyed dynamically, so subscribe through the untyped base emitter.
  type Listener = (payload: unknown) => void;
  const bus: EventEmitter = emitter;
  const subscribed: Array<[string, Listener]> = [];
  for (const [event, handler] of Object.entries(handlers) as Array<[string, Listener]>) {
    const listener: Listener = (payload) => {
      handler(payload);
      changed();
    };
    bus.on(event, listener);
    subscribed.push([event, listener]);
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    setPrompt(next) {
      prompt = next;
      changed();
    },
    setStatus(message) {
      if (message === spinnerStatus) return;
      spinnerStatus = message;
      changed();
    },
    addNotice(tone, text) {
      push('notice', tone, text);
      changed();
    },
    dispose() {
      for (const [event, listener] of subscribed) bus.off(event, listener);
      subscribed.length = 0;
      listeners.clear();
    },
  };
}
