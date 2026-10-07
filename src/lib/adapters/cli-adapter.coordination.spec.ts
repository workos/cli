import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstallerEventEmitter } from '../events.js';
import { CLIAdapter } from './cli-adapter.js';
import ui from '../../utils/ui.js';

// Only the input transport is fake: adapter, facade, spinner timers, queuing,
// cancellation and installer event delivery are real.
vi.mock('@inquirer/prompts', () => ({ confirm: vi.fn(), select: vi.fn(), input: vi.fn(), password: vi.fn() }));
vi.mock('../settings.js', () => ({ getConfig: () => ({ branding: { showAsciiArt: false } }) }));
const inquirer = await import('@inquirer/prompts');

let emitter: ReturnType<typeof createInstallerEventEmitter>;
let adapter: CLIAdapter;
let sendEvent: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;
let stdinTty: PropertyDescriptor | undefined;
let stdoutTty: PropertyDescriptor | undefined;
let questions: Array<{ message: string; answer: (value: never) => void }>;
const drain = () => vi.advanceTimersByTimeAsync(1);
const output = () => log.mock.calls.map(([chunk]) => String(chunk)).join('\n');
const frames = () => write.mock.calls.map(([chunk]) => String(chunk)).join('');
const scanQuestion = 'Found fixture.env. Check for existing WorkOS credentials?';
const scaffoldQuestion = 'This directory is empty. Scaffold a new Next.js app with AuthKit here?';

beforeEach(async () => {
  vi.useFakeTimers();
  questions = [];
  stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });
  write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const prompt of [inquirer.confirm, inquirer.select, inquirer.input, inquirer.password]) {
    vi.mocked(prompt).mockImplementation(
      (options, context) =>
        new Promise((resolve, reject) => {
          const signal = context?.signal;
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortPromptError' }));
          signal?.addEventListener('abort', abort, { once: true });
          questions.push({
            message: options.message,
            answer: (value) => {
              signal?.removeEventListener('abort', abort);
              resolve(value);
            },
          });
        }),
    );
  }
  emitter = createInstallerEventEmitter();
  sendEvent = vi.fn();
  adapter = new CLIAdapter({ emitter, sendEvent });
  await adapter.start();
  log.mockClear();
});

afterEach(async () => {
  const stopped = adapter.stop();
  await drain();
  await stopped;
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty);
  else delete (process.stdout as { isTTY?: boolean }).isTTY;
});

describe('CLI adapter with real UI coordination', () => {
  it.each(['rails', 'no-validate', 'validation'])(
    'ends the agent spinner without waiting for post-install (%s)',
    async (path) => {
      emitter.emit('agent:start', {});
      if (path === 'validation') emitter.emit('validation:start', { framework: 'nextjs' });
      emitter.emit('agent:success', { summary: 'Synthetic success' });
      expect(output().match(/Agent completed/g)).toHaveLength(1);
      write.mockClear();
      await vi.advanceTimersByTimeAsync(800);
      expect(write).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('keeps two questions isolated through spinner replacement, logs and phase completion', async () => {
    emitter.emit('agent:start', {});
    emitter.emit('credentials:env:prompt', { files: ['fixture.env'] });
    emitter.emit('scaffold:prompt', { packageManager: 'bun' });
    await drain();
    expect(questions.map((q) => q.message)).toEqual([scanQuestion]);
    write.mockClear();
    log.mockClear();
    emitter.emit('agent:tool', { kind: 'command', detail: 'synthetic tool' });
    emitter.emit('file:write', { path: '/fixture/callback.rb' });
    emitter.emit('agent:success', {});
    // Synthetic phase events only; no scaffolder, credential fetch or agent runs.
    emitter.emit('scaffold:start', { packageManager: 'bun' });
    emitter.emit('scaffold:complete', {});
    emitter.emit('agent:start', {});
    emitter.emit('agent:progress', { step: 'Synthetic current phase' });
    await vi.advanceTimersByTimeAsync(800);
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    questions[0].answer(false as never);
    await drain();
    expect(sendEvent).toHaveBeenCalledWith({ type: 'ENV_SCAN_DECLINED' });
    expect(questions.map((q) => q.message)).toEqual([scanQuestion, scaffoldQuestion]);
    emitter.emit('agent:tool', { kind: 'command', detail: 'second synthetic tool' });
    await vi.advanceTimersByTimeAsync(800);
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();

    questions[1].answer(true as never);
    await drain();
    expect(sendEvent).toHaveBeenCalledWith({ type: 'SCAFFOLD_CONFIRMED' });
    expect(output()).toContain('Agent completed');
    expect(output()).toContain('Next.js app created');
    expect(output()).toContain('callback.rb');
    expect(output()).toContain('second synthetic tool');
    write.mockClear();
    await vi.advanceTimersByTimeAsync(800);
    expect(frames()).toContain('Synthetic current phase');
    expect(frames()).not.toMatch(/Running AI|Scaffolding/);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('logging preserves a newer facade owner instead of restarting a stale adapter phase', async () => {
    emitter.emit('agent:start', {});
    const newer = ui.spinner();
    try {
      newer.start('newer owner');
      emitter.emit('agent:tool', { kind: 'command', detail: 'synthetic log' });
      write.mockClear();
      await vi.advanceTimersByTimeAsync(240);
      expect(frames()).toContain('newer owner');
      expect(frames()).not.toContain('Running AI agent');
      expect(output()).toContain('synthetic log');
      expect(output()).not.toContain('✓');
      expect(vi.getTimerCount()).toBe(1);
    } finally {
      newer.clear();
    }
  });

  it('cancelling the first question never opens the now-moot queued sibling', async () => {
    sendEvent.mockImplementation((event) => {
      if (event.type === 'GIT_CANCELLED') emitter.emit('complete', { success: false, summary: 'Cancelled' });
    });
    emitter.emit('agent:start', {});
    emitter.emit('git:dirty', { files: ['fixture.rb'] });
    emitter.emit('branch:prompt', { branch: 'main' });
    await drain();
    questions[0].answer(false as never);
    await drain();
    expect(questions.map((q) => q.message)).toEqual(['Continue anyway?']);
    expect(output()).toContain('Cancelled');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['failure', 'error', 'complete', 'stop', 'sigint'] as const)(
    '%s aborts open/queued prompts and retires all animation',
    async (end) => {
      emitter.emit('agent:start', {});
      emitter.emit('credentials:env:prompt', { files: ['fixture.env'] });
      emitter.emit('scaffold:prompt', { packageManager: 'bun' });
      await drain();
      write.mockClear();
      let stopped: Promise<void> | undefined;
      if (end === 'failure') emitter.emit('agent:failure', { message: 'Synthetic failure' });
      if (end === 'error') emitter.emit('error', { message: 'Synthetic failure' });
      if (end === 'complete') emitter.emit('complete', { success: true, summary: 'Synthetic completion' });
      if (end === 'stop') stopped = adapter.stop();
      if (end === 'sigint') process.emit('SIGINT');
      await vi.advanceTimersByTimeAsync(800);
      await stopped;
      expect(questions).toHaveLength(1);
      expect(write).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      if (end === 'failure') expect(output()).toContain('Agent failed');
      if (end === 'error') expect(output()).toContain('Synthetic failure');
      if (end === 'complete') expect(output()).toContain('Synthetic completion');
    },
  );
});
