import { describe, it, expect } from 'vitest';
import { createActor, fromPromise } from 'xstate';
import { installerMachine } from '../../lib/installer-core.js';
import { createInstallerEventEmitter, type InstallerEventEmitter, type InstallerEventName } from '../../lib/events.js';
import type { InstallerOptions } from '../../utils/types.js';
import type {
  AgentOutput,
  BranchCheckOutput,
  DetectionOutput,
  GitCheckOutput,
  InstallerMachineContext,
  WorkspaceCheckOutput,
} from '../../lib/installer-core.types.js';
import { WALKTHROUGH_PARAMS, loadInstallerContent, parseInstallerContent, placeholdersOf } from '../content/index.js';
import { countedTasks, createRunModel, type RunModel, type RunSnapshot, type TaskStatus } from './run-model.js';

const content = loadInstallerContent();
const INSTALL_DIR = '/work/my-app';

function actors(overrides: Record<string, unknown> = {}) {
  return {
    checkAuthentication: fromPromise<boolean, { options: InstallerOptions }>(async () => true),
    checkWorkspace: fromPromise<WorkspaceCheckOutput, { options: InstallerOptions }>(async () => ({
      scaffoldable: false,
      packageManager: 'npm',
      autoScaffold: false,
    })),
    runScaffold: fromPromise<void, { context: InstallerMachineContext }>(async () => {}),
    detectIntegration: fromPromise<DetectionOutput, { options: InstallerOptions }>(async () => ({
      integration: 'nextjs',
    })),
    checkGitStatus: fromPromise<GitCheckOutput, { installDir: string }>(async () => ({ isClean: true, files: [] })),
    configureEnvironment: fromPromise<void, { context: InstallerMachineContext }>(async () => {}),
    runAgent: fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
      success: true,
      summary: 'Done!',
    })),
    ...overrides,
  };
}

function options(overrides: Partial<InstallerOptions> = {}): InstallerOptions {
  return {
    debug: false,
    forceInstall: false,
    installDir: INSTALL_DIR,
    default: false,
    local: true,
    ci: false,
    skipAuth: false,
    noCommit: true,
    emitter: null!,
    apiKey: 'sk_test_123',
    clientId: 'client_test_123',
    ...overrides,
  } as InstallerOptions;
}

interface Run {
  model: RunModel;
  emitter: InstallerEventEmitter;
  /** Every distinct snapshot, in order. */
  history: RunSnapshot[];
  actor: ReturnType<typeof createActor<typeof installerMachine>>;
  done: Promise<void>;
}

function start(opts: InstallerOptions, mocks: ReturnType<typeof actors>, onEvent?: (run: Run) => void): Run {
  const emitter = createInstallerEventEmitter();
  // Node's EventEmitter throws on an 'error' event nobody listens to. In a real
  // run the adapter always listens; here only the model is attached.
  emitter.on('error', () => {});
  const model = createRunModel({ emitter, content, cwd: INSTALL_DIR, now: new Date('2026-09-24T12:00:00Z') });
  const actor = createActor(installerMachine.provide({ actors: mocks }), {
    input: { emitter, options: { ...opts, emitter } },
  });
  const history: RunSnapshot[] = [model.getSnapshot()];
  const run = { model, emitter, history, actor } as Run;
  model.subscribe(() => {
    history.push(model.getSnapshot());
    onEvent?.(run);
  });
  run.done = new Promise<void>((resolve, reject) => {
    actor.subscribe({ complete: () => resolve(), error: reject });
  });
  actor.start();
  actor.send({ type: 'START' });
  return run;
}

const statuses = (s: RunSnapshot) => Object.fromEntries(s.tasks.map((t) => [t.id, t.status]));
const texts = (s: RunSnapshot, kind?: string) =>
  s.walkthrough.filter((e) => !kind || e.kind === kind).map((e) => e.text);
const RANK: Record<TaskStatus, number> = {
  pending: 0,
  in_progress: 1,
  completed: 2,
  skipped: 2,
  failed: 2,
  cancelled: 2,
  next: 2,
  attention: 2,
};

/** A task only ever moves forward: pending → in_progress → a final state. */
function expectMonotonic(history: RunSnapshot[]): void {
  const last = new Map<string, TaskStatus>();
  for (const snapshot of history) {
    for (const task of snapshot.tasks) {
      const prev = last.get(task.id);
      if (prev) {
        expect(RANK[task.status], `${task.id}: ${prev} → ${task.status}`).toBeGreaterThanOrEqual(RANK[prev]);
        if (RANK[prev] === 2) expect(task.status, `${task.id} changed after finishing`).toBe(prev);
      }
      last.set(task.id, task.status);
    }
  }
}

describe('run model: tasks follow real installer events', () => {
  it('starts with every required task pending and nothing optional shown', () => {
    const emitter = createInstallerEventEmitter();
    const snapshot = createRunModel({ emitter, content }).getSnapshot();
    expect(statuses(snapshot)).toEqual({
      'sign-in': 'pending',
      inspect: 'pending',
      credentials: 'pending',
      configure: 'pending',
      install: 'pending',
      finish: 'pending',
      'first-sign-up': 'pending',
    });
    expect(snapshot.outcome).toBeNull();
  });

  it('completes every task on a successful run, in order', async () => {
    const run = start(options(), actors());
    await run.done;
    const final = run.model.getSnapshot();

    expect(statuses(final)).toEqual({
      'sign-in': 'completed',
      inspect: 'completed',
      credentials: 'completed',
      configure: 'completed',
      install: 'completed',
      finish: 'completed',
      // The installer's done; the first sign-up is the user's next step.
      'first-sign-up': 'next',
    });
    expect(final.outcome).toBe('success');
    expect(final.integration).toBe('nextjs');
    expect(final.framework).toBe('Next.js');
    expectMonotonic(run.history);

    // Each task was seen in progress before it completed.
    for (const id of ['sign-in', 'inspect', 'configure', 'install']) {
      expect(
        run.history.some((s) => statuses(s)[id] === 'in_progress'),
        id,
      ).toBe(true);
    }
    // Only one task is in progress at a time.
    for (const s of run.history) {
      expect(s.tasks.filter((t) => t.status === 'in_progress').length).toBeLessThanOrEqual(1);
    }
  });

  it('narrates the run using the content copy', async () => {
    const run = start(options(), actors());
    await run.done;
    const narration = texts(run.model.getSnapshot(), 'narration');

    expect(narration).toContain(content.walkthrough['auth:checking']);
    expect(narration).toContain(content.walkthrough['auth:success']);
    expect(narration).toContain('This is a Next.js app. I know how to set that up.');
    expect(narration).toContain(content.walkthrough['config:start']);
    expect(narration).toContain(content.walkthrough['agent:start']);
    expect(narration.at(-1)).toBe((content.walkthrough.complete as Record<string, string>).success);
    expect(run.model.getSnapshot().walkthrough.at(-1)!.tone).toBe('success');
  });

  it('marks sign-in skipped with --skip-auth', async () => {
    const run = start(options({ skipAuth: true }), actors());
    await run.done;
    expect(statuses(run.model.getSnapshot())['sign-in']).toBe('skipped');
    expect(run.history.every((s) => statuses(s)['sign-in'] !== 'in_progress')).toBe(true);
  });

  it('shows agent status lines, file changes, commands, and a validation step', async () => {
    const runAgent = fromPromise<AgentOutput, { context: InstallerMachineContext }>(async ({ input }) => {
      const e = input.context.emitter;
      e.emit('agent:progress', { step: 'Reading your project' });
      e.emit('agent:progress', { step: 'Reading your project' }); // duplicate
      e.emit('file:write', { path: `${INSTALL_DIR}/app/callback/route.ts`, content: '' });
      e.emit('file:edit', { path: `${INSTALL_DIR}/app/layout.tsx`, oldContent: '', newContent: '' });
      e.emit('file:edit', { path: `${INSTALL_DIR}/app/layout.tsx`, oldContent: '', newContent: '' }); // same path
      e.emit('agent:tool', { kind: 'command', detail: `npm install @workos-inc/authkit-nextjs ${'x'.repeat(100)}` });
      e.emit('validation:start', { framework: 'nextjs' });
      e.emit('validation:complete', { passed: false, issueCount: 2, durationMs: 5 });
      return { success: true, summary: 'Done!' };
    });
    const run = start(options(), actors({ runAgent }));
    await run.done;
    const final = run.model.getSnapshot();

    expect(texts(final, 'status')).toEqual(['Reading your project']);
    expect(texts(final, 'file')).toEqual(['Created app/callback/route.ts', 'Updated app/layout.tsx']);
    const [command] = texts(final, 'command');
    expect(command.startsWith('Ran npm install @workos-inc/authkit-nextjs')).toBe(true);
    expect(command.length).toBeLessThanOrEqual('Ran '.length + 80);
    expect(command.endsWith('…')).toBe(true);

    // validation:complete reported passed: false, so verify must settle as failed.
    expect(statuses(final)).toMatchObject({ install: 'completed', verify: 'failed' });
    expect(final.tasks.map((t) => t.id)).toEqual([
      'sign-in',
      'inspect',
      'credentials',
      'configure',
      'install',
      'verify',
      'finish',
      'first-sign-up',
    ]);
    const issue = final.walkthrough.find((e) => e.text.includes('issues: 2'));
    expect(issue?.tone).toBe('warning');
    expectMonotonic(run.history);
  });

  it('does not mark verify completed when blocking validation fails (passed: false)', async () => {
    // A blocking validation/security finding surfaces as validation:complete
    // with passed: false; the agent then fails so the run ends unsuccessfully.
    const runAgent = fromPromise<AgentOutput, { context: InstallerMachineContext }>(async ({ input }) => {
      const e = input.context.emitter;
      e.emit('validation:start', { framework: 'nextjs' });
      e.emit('validation:complete', { passed: false, issueCount: 2, durationMs: 5 });
      return { success: false, error: new Error('blocked by security gate') };
    });
    const run = start(options(), actors({ runAgent }));
    await run.done;
    const final = run.model.getSnapshot();

    // The verify step must reflect the failed validation, not report success.
    expect(statuses(final)).toMatchObject({ install: 'completed', verify: 'failed' });
    const issue = final.walkthrough.find((e) => e.text.includes('issues: 2'));
    expect(issue?.tone).toBe('warning');
    expectMonotonic(run.history);
  });

  it('marks verify completed when validation ultimately passes after retries', async () => {
    // Non-blocking validation self-corrects across retries and the final
    // validation:complete reports passed: true, so verify settles as completed.
    const runAgent = fromPromise<AgentOutput, { context: InstallerMachineContext }>(async ({ input }) => {
      const e = input.context.emitter;
      e.emit('validation:start', { framework: 'nextjs' });
      e.emit('validation:retry:start', { attempt: 1 });
      e.emit('validation:retry:complete', { attempt: 1, passed: false });
      e.emit('validation:retry:start', { attempt: 2 });
      e.emit('validation:retry:complete', { attempt: 2, passed: true });
      e.emit('validation:complete', { passed: true, issueCount: 0, durationMs: 5 });
      return { success: true, summary: 'Done!' };
    });
    const run = start(options(), actors({ runAgent }));
    await run.done;
    expect(statuses(run.model.getSnapshot())).toMatchObject({ install: 'completed', verify: 'completed' });
  });

  it('fails the install task when the agent fails', async () => {
    const runAgent = fromPromise<AgentOutput, { context: InstallerMachineContext }>(async () => ({
      success: false,
      error: new Error('boom'),
    }));
    const run = start(options(), actors({ runAgent }));
    await run.done;
    const final = run.model.getSnapshot();

    expect(statuses(final)).toMatchObject({
      configure: 'completed',
      install: 'failed',
      finish: 'pending',
      // Only a finished install makes the first sign-up the next step.
      'first-sign-up': 'pending',
    });
    expect(final.outcome).toBe('failure');
    expect(texts(final, 'narration')).toContain(content.walkthrough['agent:failure']);
    expect(final.walkthrough.at(-1)).toMatchObject({
      text: (content.walkthrough.complete as Record<string, string>).failure,
      tone: 'error',
    });
    expectMonotonic(run.history);
  });

  it('fails the validation task, not the install task, when the run fails after validating', async () => {
    const runAgent = fromPromise<AgentOutput, { context: InstallerMachineContext }>(async ({ input }) => {
      input.context.emitter.emit('validation:start', { framework: 'nextjs' });
      return { success: false, error: new Error('validation crashed') };
    });
    const run = start(options(), actors({ runAgent }));
    await run.done;
    expect(statuses(run.model.getSnapshot())).toMatchObject({ install: 'completed', verify: 'failed' });
  });

  it('fails the inspect task when no framework is detected', async () => {
    const detectIntegration = fromPromise<DetectionOutput, { options: InstallerOptions }>(async () => ({
      integration: undefined,
    }));
    const run = start(options(), actors({ detectIntegration }));
    await run.done;
    const final = run.model.getSnapshot();
    expect(statuses(final)).toMatchObject({ 'sign-in': 'completed', inspect: 'failed', credentials: 'pending' });
    expect(texts(final, 'narration')).toContain(content.walkthrough['detection:none']);
    expect(final.outcome).toBe('failure');
  });

  it('cancels the current task when the user declines a dirty working tree', async () => {
    const checkGitStatus = fromPromise<GitCheckOutput, { installDir: string }>(async () => ({
      isClean: false,
      files: ['a.ts', 'b.ts', 'c.ts'],
    }));
    let answered = false;
    const run = start(options(), actors({ checkGitStatus }), (r) => {
      if (!answered && texts(r.model.getSnapshot()).some((t) => t.includes('uncommitted'))) {
        answered = true;
        queueMicrotask(() => r.actor.send({ type: 'GIT_CANCELLED' }));
      }
    });
    await run.done;
    const final = run.model.getSnapshot();

    expect(texts(final, 'narration')).toContain(
      "You have uncommitted changes (files: 3), so I'll check with you before going further.",
    );
    expect(statuses(final)).toMatchObject({ inspect: 'cancelled', credentials: 'pending' });
    expect(final.outcome).toBe('cancelled');
    expect(final.walkthrough.at(-1)!.text).toBe((content.walkthrough.complete as Record<string, string>).cancelled);
  });

  it('shows the scaffold task only when this run scaffolds', async () => {
    const checkWorkspace = fromPromise<WorkspaceCheckOutput, { options: InstallerOptions }>(async () => ({
      scaffoldable: true,
      packageManager: 'pnpm',
      autoScaffold: false,
    }));
    let confirmed = false;
    const run = start(options(), actors({ checkWorkspace }), (r) => {
      if (!confirmed && statuses(r.model.getSnapshot()).scaffold === 'in_progress') {
        confirmed = true;
        queueMicrotask(() => r.actor.send({ type: 'SCAFFOLD_CONFIRMED' }));
      }
    });
    await run.done;
    const final = run.model.getSnapshot();

    expect(final.tasks.map((t) => t.id).slice(0, 3)).toEqual(['sign-in', 'scaffold', 'inspect']);
    expect(statuses(final).scaffold).toBe('completed');
    expect(texts(final, 'narration')).toContain('Creating a new Next.js app with pnpm. This can take a minute.');
    expectMonotonic(run.history);
  });

  it('narrates a protected branch and the branch it creates', async () => {
    const checkBranch = fromPromise<BranchCheckOutput, void>(async () => ({ branch: 'main', isProtected: true }));
    const createBranch = fromPromise<{ branch: string }, { name: string; fallbackName: string }>(async ({ input }) => ({
      branch: input.name,
    }));
    let answered = false;
    const run = start(options(), actors({ checkBranch, createBranch }), (r) => {
      if (!answered && texts(r.model.getSnapshot()).some((t) => t.startsWith("You're on main"))) {
        answered = true;
        queueMicrotask(() => r.actor.send({ type: 'BRANCH_CREATE' }));
      }
    });
    await run.done;
    expect(texts(run.model.getSnapshot(), 'narration')).toContain(
      'I made a new branch, feat/add-workos-authkit, so these changes stay separate.',
    );
  });
});

describe('run model: tips, prompt, status, notices', () => {
  it('adds framework-targeted tips once the framework is detected', async () => {
    const run = start(options(), actors());
    expect(run.history[0].tips.some((t) => t.frameworks)).toBe(false);
    await run.done;
    const tips = run.model.getSnapshot().tips;
    expect(tips.some((t) => t.id === 'nextjs-guide')).toBe(true);
    expect(tips.some((t) => t.id === 'react-guide')).toBe(false);
  });

  it('filters announcements by the model clock', () => {
    const dated = parseInstallerContent({
      ...structuredClone(content),
      announcements: [
        { id: 'october', title: 'Oct', body: 'Only in October.', startsAt: '2026-10-01', endsAt: '2026-10-31' },
      ],
    });
    const emitter = createInstallerEventEmitter();
    const before = createRunModel({ emitter, content: dated, now: new Date('2026-09-30T00:00:00Z') });
    const during = createRunModel({ emitter, content: dated, now: new Date('2026-10-15T00:00:00Z') });
    expect(before.getSnapshot().announcements).toEqual([]);
    expect(during.getSnapshot().announcements.map((a) => a.id)).toEqual(['october']);
  });

  it('holds the pending prompt, the running status, and notices', () => {
    const model = createRunModel({ emitter: createInstallerEventEmitter(), content });
    let notified = 0;
    const unsubscribe = model.subscribe(() => notified++);

    model.setPrompt({ kind: 'confirm', message: 'Commit the changes?', initialValue: true });
    expect(model.getSnapshot().prompt).toEqual({ kind: 'confirm', message: 'Commit the changes?', initialValue: true });
    model.setStatus('Generating commit message...');
    const withStatus = model.getSnapshot();
    model.setStatus('Generating commit message...'); // unchanged: same snapshot
    expect(model.getSnapshot()).toBe(withStatus);
    model.addNotice('error', 'Commit failed: nothing to commit');
    model.setPrompt(null);

    const snapshot = model.getSnapshot();
    expect(snapshot.prompt).toBeNull();
    expect(snapshot.status).toBe('Generating commit message...');
    expect(snapshot.walkthrough.at(-1)).toMatchObject({
      kind: 'notice',
      tone: 'error',
      text: 'Commit failed: nothing to commit',
    });
    expect(notified).toBeGreaterThan(0);

    unsubscribe();
    const before = notified;
    model.setStatus(null);
    expect(notified).toBe(before);
  });

  it('returns the same snapshot object until something changes', () => {
    const emitter = createInstallerEventEmitter();
    const model = createRunModel({ emitter, content });
    const a = model.getSnapshot();
    expect(model.getSnapshot()).toBe(a);
    emitter.emit('auth:checking', {});
    expect(model.getSnapshot()).not.toBe(a);
  });

  it('stops listening after dispose', () => {
    const emitter = createInstallerEventEmitter();
    const model = createRunModel({ emitter, content });
    model.dispose();
    emitter.emit('auth:checking', {});
    expect(model.getSnapshot().walkthrough).toEqual([]);
    expect(emitter.listenerCount('auth:checking')).toBe(0);
  });

  it('keeps only the newest walkthrough entries', () => {
    const emitter = createInstallerEventEmitter();
    const model = createRunModel({ emitter, content, maxEntries: 3 });
    for (let i = 0; i < 5; i++) emitter.emit('agent:progress', { step: `step ${i}` });
    expect(texts(model.getSnapshot())).toEqual(['step 2', 'step 3', 'step 4']);
  });

  it('fills every placeholder for each event that supplies params', () => {
    const payloads: Partial<Record<InstallerEventName, unknown>> = {
      'scaffold:start': { packageManager: 'pnpm' },
      'detection:complete': { integration: 'react' },
      'git:dirty': { files: ['a'] },
      'branch:protected': { branch: 'main' },
      'branch:created': { branch: 'feat/x' },
      'credentials:env:found': { sourcePath: `${INSTALL_DIR}/.env.local` },
      'device:started': {
        verificationUri: 'https://w.os/d',
        verificationUriComplete: 'https://w.os/d?c=1',
        userCode: 'ABCD',
      },
      'agent:retry': { attempt: 2, maxRetries: 3 },
      'file:write': { path: `${INSTALL_DIR}/a.ts`, content: '' },
      'file:edit': { path: `${INSTALL_DIR}/b.ts`, oldContent: '', newContent: '' },
      'agent:tool': { kind: 'command', detail: 'ls' },
      'validation:complete': { passed: false, issueCount: 1, durationMs: 1 },
      'postinstall:changes': { files: ['a'] },
      'postinstall:commit:success': { message: 'feat: add AuthKit' },
      'postinstall:pr:success': { url: 'https://github.com/o/r/pull/1' },
    };
    expect(Object.keys(payloads).sort()).toEqual(Object.keys(WALKTHROUGH_PARAMS).sort());

    for (const [event, payload] of Object.entries(payloads)) {
      const emitter = createInstallerEventEmitter();
      const model = createRunModel({ emitter, content, cwd: INSTALL_DIR });
      emitter.emit(event as InstallerEventName, payload as never);
      const entries = model.getSnapshot().walkthrough;
      expect(entries.length, event).toBe(1);
      expect(placeholdersOf(entries[0].text), `${event}: ${entries[0].text}`).toEqual([]);
    }
  });

  it('prefers the one-click device URL and shows env files relative to the project', () => {
    const emitter = createInstallerEventEmitter();
    const model = createRunModel({ emitter, content, cwd: INSTALL_DIR });
    emitter.emit('device:started', {
      verificationUri: 'https://w.os/d',
      verificationUriComplete: 'https://w.os/d?c=1',
      userCode: 'ABCD',
    });
    emitter.emit('credentials:env:found', { sourcePath: `${INSTALL_DIR}/.env.local` });
    expect(texts(model.getSnapshot())).toEqual([
      'Open https://w.os/d?c=1 in your browser and enter the code ABCD to connect this computer to WorkOS.',
      'Found your WorkOS keys in .env.local.',
    ]);
  });
});

describe('run model: the dashboard checklist', () => {
  function configuring() {
    const emitter = createInstallerEventEmitter();
    emitter.on('error', () => {});
    const model = createRunModel({ emitter, content });
    emitter.emit('state:enter', { state: 'configuring' });
    emitter.emit('config:start', {});
    return { emitter, model };
  }
  /** Through the configure step and into the agent's validation, like a Next.js run. */
  function validating() {
    const { emitter, model } = configuring();
    emitter.emit('config:step', { step: 'env-vars', status: 'started' });
    emitter.emit('config:step', { step: 'env-vars', status: 'done' });
    emitter.emit('state:exit', { state: 'configuring' });
    emitter.emit('state:enter', { state: 'runningAgent' });
    emitter.emit('validation:start', { framework: 'nextjs' });
    emitter.emit('validation:complete', { passed: true, issueCount: 0, durationMs: 1 });
    return { emitter, model };
  }
  const APP_URLS = ['redirect-uri', 'initiate-login-uri', 'sign-out-uri'] as const;
  const task = (model: RunModel, id: string) => model.getSnapshot().tasks.find((t) => t.id === id);
  const subStatuses = (model: RunModel, id: string) =>
    Object.fromEntries((task(model, id)?.subtasks ?? []).map((s) => [s.id, s.status]));

  it("lists the reported items under Configure WorkOS, in the dashboard's order and words", () => {
    const { emitter, model } = configuring();
    expect(task(model, 'configure')?.subtasks).toBeUndefined();

    // Reported out of order; shown in the dashboard's.
    for (const step of ['cors-origin', 'env-vars', 'redirect-uri'] as const) {
      emitter.emit('config:step', { step, status: 'started' });
    }
    expect(task(model, 'configure')?.subtasks?.map((s) => s.label)).toEqual([
      'Add environment variables',
      'Set redirect URI',
      'Set CORS origin',
    ]);

    emitter.emit('config:step', { step: 'redirect-uri', status: 'done' });
    emitter.emit('config:step', { step: 'cors-origin', status: 'already-set' });
    expect(subStatuses(model, 'configure')).toEqual({
      'env-vars': 'in_progress',
      'redirect-uri': 'completed',
      'cors-origin': 'completed',
    });
  });

  it('collapses back to one row once every item landed', () => {
    const { emitter, model } = configuring();
    for (const step of ['env-vars', 'redirect-uri', 'cors-origin'] as const) {
      emitter.emit('config:step', { step, status: 'started' });
      emitter.emit('config:step', { step, status: 'done' });
    }
    expect(task(model, 'configure')?.subtasks).toHaveLength(3); // still configuring

    emitter.emit('state:exit', { state: 'configuring' });
    emitter.emit('state:enter', { state: 'runningAgent' });
    expect(task(model, 'configure')?.status).toBe('completed');
    expect(task(model, 'configure')?.subtasks).toBeUndefined();
  });

  it('connects the app URLs after the agent, as their own task', () => {
    const { emitter, model } = validating();
    expect(task(model, 'app-urls')).toBeUndefined();

    for (const step of APP_URLS) emitter.emit('app-urls:step', { step, status: 'started' });
    expect(task(model, 'verify')?.status).toBe('completed');
    expect(task(model, 'app-urls')?.status).toBe('in_progress');
    expect(task(model, 'app-urls')?.subtasks?.map((s) => s.label)).toEqual([
      'Set redirect URI',
      'Set initiate login URI',
      'Set sign-out URI',
    ]);
    expect(model.getSnapshot().walkthrough.at(-1)?.text).toBe(content.walkthrough['app-urls:step']);

    for (const step of APP_URLS) emitter.emit('app-urls:step', { step, status: 'done' });
    emitter.emit('state:exit', { state: 'runningAgent' });
    emitter.emit('state:enter', { state: 'postInstall' });
    expect(task(model, 'app-urls')?.status).toBe('completed');
    expect(task(model, 'app-urls')?.subtasks).toBeUndefined();
    expect(
      model
        .getSnapshot()
        .tasks.map((t) => t.id)
        .slice(-3),
    ).toEqual(['app-urls', 'finish', 'first-sign-up']);
  });

  it('keeps unverified items open with one line for their shared reason, and ends on a warning', () => {
    const { emitter, model } = validating();
    const reason = 'Callback registered using the API key. Sign in to the correct team to manage those settings.';
    for (const step of APP_URLS) emitter.emit('app-urls:step', { step, status: 'started' });
    emitter.emit('app-urls:step', { step: 'redirect-uri', status: 'done' });
    emitter.emit('app-urls:step', { step: 'initiate-login-uri', status: 'skipped', detail: reason });
    emitter.emit('app-urls:step', { step: 'sign-out-uri', status: 'skipped', detail: reason });
    emitter.emit('state:exit', { state: 'runningAgent' });
    emitter.emit('state:enter', { state: 'postInstall' });
    emitter.emit('state:exit', { state: 'postInstall' });
    emitter.emit('state:enter', { state: 'complete' });
    emitter.emit('complete', { success: true });

    expect(subStatuses(model, 'app-urls')).toEqual({
      'redirect-uri': 'completed',
      'initiate-login-uri': 'attention',
      'sign-out-uri': 'attention',
    });
    // The task shares its settings' `!` and doesn't count as done.
    expect(statuses(model.getSnapshot())['app-urls']).toBe('attention');
    const counted = countedTasks(model.getSnapshot().tasks);
    expect(counted.filter((t) => t.status === 'completed')).toHaveLength(counted.length - 1);
    const notices = model.getSnapshot().walkthrough.filter((e) => e.kind === 'notice');
    expect(notices).toEqual([
      expect.objectContaining({
        tone: 'warning',
        text: `Check in the WorkOS dashboard: set initiate login URI and set sign-out URI. ${reason}`,
      }),
    ]);
    expect(model.getSnapshot().walkthrough.at(-1)).toMatchObject({
      tone: 'warning',
      text: content.walkthrough.complete['setup-required'],
    });
  });

  it("doesn't end on all done when a setting failed but the install carried on", () => {
    const { emitter, model } = configuring();
    emitter.emit('config:step', { step: 'redirect-uri', status: 'started' });
    emitter.emit('config:step', { step: 'redirect-uri', status: 'failed', detail: 'Request failed (403)' });
    emitter.emit('state:exit', { state: 'configuring' });
    emitter.emit('state:enter', { state: 'complete' });
    emitter.emit('complete', { success: true });
    expect(statuses(model.getSnapshot()).configure).toBe('attention');
    expect(model.getSnapshot().walkthrough.at(-1)).toMatchObject({
      tone: 'warning',
      text: content.walkthrough.complete['setup-required'],
    });
  });

  it('explains a failed item and fails the ones still running when the install errors', () => {
    const { emitter, model } = configuring();
    for (const step of ['env-vars', 'redirect-uri', 'cors-origin'] as const) {
      emitter.emit('config:step', { step, status: 'started' });
    }
    emitter.emit('config:step', { step: 'redirect-uri', status: 'failed', detail: 'Request failed (500)' });
    expect(model.getSnapshot().walkthrough.at(-1)).toMatchObject({
      tone: 'error',
      text: "Couldn't set redirect URI. Request failed (500). Set it in the WorkOS dashboard.",
    });

    emitter.emit('state:exit', { state: 'configuring' });
    emitter.emit('state:enter', { state: 'error' });
    expect(task(model, 'configure')?.status).toBe('failed');
    expect(subStatuses(model, 'configure')).toMatchObject({ 'env-vars': 'failed', 'cors-origin': 'failed' });
  });

  it('shows no items when the installer reports none (non-JS integrations)', () => {
    const { emitter, model } = configuring();
    emitter.emit('config:complete', {});
    emitter.emit('state:exit', { state: 'configuring' });
    emitter.emit('state:enter', { state: 'runningAgent' });
    expect(task(model, 'configure')?.subtasks).toBeUndefined();
  });

  it("doesn't count the first sign-up toward done", () => {
    const tasks = createRunModel({ emitter: createInstallerEventEmitter(), content }).getSnapshot().tasks;
    expect(tasks.map((t) => t.id)).toContain('first-sign-up');
    expect(countedTasks(tasks).map((t) => t.id)).not.toContain('first-sign-up');
  });
});
