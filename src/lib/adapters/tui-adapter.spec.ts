import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createInstallerEventEmitter, type InstallerEventEmitter } from '../events.js';
import ui, { CANCEL, getUiHost, isCancel } from '../../utils/ui.js';
import { ENTER_FULLSCREEN, LEAVE_FULLSCREEN } from '../../tui/terminal.js';
import { FakeStdin, FakeStdout, KEY, stripAnsi, waitFor } from '../../tui/ink-streams.test-utils.js';
import { TuiAdapter } from './tui-adapter.js';
import { CLIAdapter } from './cli-adapter.js';

let emitter: InstallerEventEmitter;
let sendEvent: ReturnType<typeof vi.fn>;
let stdout: FakeStdout;
let stdin: FakeStdin;
let adapter: TuiAdapter;
let stdinTty: PropertyDescriptor | undefined;
const originalLog = console.log;

function create(overrides: Partial<ConstructorParameters<typeof TuiAdapter>[0]> = {}) {
  return new TuiAdapter({
    emitter,
    sendEvent,
    installDir: '/work/my-app',
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    tipIntervalMs: 60_000,
    renderFrames: true,
    ...overrides,
  });
}

const frame = () => stripAnsi(stdout.lastFrame('WorkOS AuthKit installer'));
/** Everything written after the full screen closed. */
const afterExit = () => {
  const output = stdout.output();
  return stripAnsi(output.slice(output.lastIndexOf(LEAVE_FULLSCREEN) + LEAVE_FULLSCREEN.length));
};

beforeEach(() => {
  emitter = createInstallerEventEmitter();
  sendEvent = vi.fn();
  stdout = new FakeStdout(100, 30);
  stdin = new FakeStdin();
  // ui's prompt guard checks the real stdin.
  stdinTty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  adapter = create();
});

afterEach(async () => {
  await adapter.stop();
  if (stdinTty) Object.defineProperty(process.stdin, 'isTTY', stdinTty);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
  vi.restoreAllMocks();
});

describe('TuiAdapter', () => {
  it('enters the alternate screen and draws the installer', async () => {
    await adapter.start();
    expect(stdout.writes[0]).toBe(ENTER_FULLSCREEN);
    await waitFor(() => expect(frame()).toContain('WorkOS AuthKit installer'));
    expect(frame()).toContain('Tasks');
    expect(getUiHost()).not.toBeNull();
  });

  it('keeps direct console output off the full screen', async () => {
    await adapter.start();
    console.log('stray line');
    expect(stdout.output()).not.toContain('stray line');
    await adapter.stop();
    expect(afterExit()).toContain('stray line');
  });

  it("answers the plain CLI's git-dirty question inline (No → GIT_CANCELLED)", async () => {
    await adapter.start();
    emitter.emit('git:dirty', { files: ['a.ts', 'b.ts'] });

    await waitFor(() => expect(frame()).toContain('? Continue anyway?'));
    expect(frame()).toContain('You have uncommitted changes (files: 2)');
    // The question comes with the list the plain CLI prints above it.
    const lines = frame().split('\n');
    const at = (text: string) => lines.findIndex((l) => l.includes(text));
    expect(at('! You have uncommitted or untracked files:')).toBeGreaterThan(-1);
    expect(at('a.ts')).toBeGreaterThan(at('! You have uncommitted or untracked files:'));
    expect(at('b.ts')).toBe(at('a.ts') + 1);
    expect(at('? Continue anyway?')).toBe(at('b.ts') + 1);
    stdin.press('n');
    await waitFor(() => expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CANCELLED' }));
    await waitFor(() => expect(frame()).not.toContain('? Continue anyway?'));
  });

  it("answers the plain CLI's branch question inline with the arrow keys", async () => {
    await adapter.start();
    emitter.emit('branch:prompt', { branch: 'main' });

    await waitFor(() => expect(frame()).toContain('› Create feat/add-workos-authkit'));
    stdin.press(KEY.down);
    await waitFor(() => expect(frame()).toContain('› Continue on current branch'));
    stdin.press(KEY.enter);
    await waitFor(() => expect(sendEvent).toHaveBeenCalledWith({ type: 'BRANCH_CONTINUE' }));
  });

  it('cancels an open question on esc, the same as cancelling it in the plain CLI', async () => {
    await adapter.start();
    emitter.emit('postinstall:commit:prompt', {});
    await waitFor(() => expect(frame()).toContain('? Commit the changes?'));
    stdin.press(KEY.escape);
    await waitFor(() => expect(sendEvent).toHaveBeenCalledWith({ type: 'COMMIT_DECLINED' }));
  });

  it('sends ctrl-c down the existing SIGINT → CANCEL path', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    // Stands in for runWithCore's SIGINT handler, which sends CANCEL to the machine.
    const runWithCoreSigint = () => sendEvent({ type: 'CANCEL' });
    process.on('SIGINT', runWithCoreSigint);
    try {
      await adapter.start();
      await waitFor(() => expect(frame()).toContain('ctrl-c cancel'));
      stdin.press(KEY.ctrlC);
      await waitFor(() => expect(exit).toHaveBeenCalledWith(0));
      expect(sendEvent).toHaveBeenCalledWith({ type: 'CANCEL' });
    } finally {
      process.off('SIGINT', runWithCoreSigint);
    }
    await adapter.stop();
    // The plain CLI's cancel message survives into the scrollback.
    expect(afterExit()).toContain('Installer cancelled');
  });

  it('shows the device-flow code and waiting status', async () => {
    await adapter.start();
    emitter.emit('device:started', {
      verificationUri: 'https://api.workos.com/device',
      verificationUriComplete: 'https://api.workos.com/device?code=WXYZ-1234',
      userCode: 'WXYZ-1234',
    });
    await waitFor(() => expect(frame()).toContain('enter the code WXYZ-1234'));
    expect(frame()).toContain('Waiting for authentication...');
  });

  it('surfaces errors the installer prints in the walkthrough', async () => {
    await adapter.start();
    emitter.emit('postinstall:commit:failed', { error: 'nothing to commit' });
    await waitFor(() => expect(frame()).toContain('✗ Commit failed: nothing to commit'));
  });

  it('leaves the alternate screen on stop and prints the plain completion summary', async () => {
    await adapter.start();
    emitter.emit('git:dirty', { files: ['a.ts'] });
    await waitFor(() => expect(frame()).toContain('? Continue anyway?'));
    stdin.press('y');
    await waitFor(() => expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CONFIRMED' }));
    emitter.emit('complete', { success: true, summary: 'AuthKit is set up.' });
    await adapter.stop();

    const output = stdout.output();
    expect(output.lastIndexOf(LEAVE_FULLSCREEN)).toBeGreaterThan(output.indexOf(ENTER_FULLSCREEN));
    const scrollback = afterExit();
    expect(scrollback).toContain('✔ Continue anyway? Yes');
    expect(scrollback).toContain('WorkOS AuthKit Installed');
    // The view already showed the logo; the scrollback doesn't repeat the opener.
    expect(scrollback).not.toContain('AuthKit installer');
    expect(scrollback).not.toContain('▄▄██');
    expect(scrollback.trimStart().startsWith('! You have uncommitted or untracked files:')).toBe(true);
    expect(getUiHost()).toBeNull();
    expect(console.log).toBe(originalLog);
    expect(stdin.rawMode).toBe(false);
  });

  it("leaves the agent's play-by-play out of the scrollback, keeping what matters", async () => {
    await adapter.start();
    emitter.emit('agent:start', {});
    emitter.emit('agent:progress', { step: 'Phase 2: Installing SDK' });
    emitter.emit('agent:tool', { kind: 'command', detail: 'pnpm add @workos-inc/authkit-nextjs' });
    emitter.emit('file:write', { path: '/work/my-app/app/callback/route.ts' });
    ui.log.warn('The build printed a warning');
    emitter.emit('validation:start', { framework: 'nextjs' });
    emitter.emit('validation:issues', {
      issues: [{ type: 'file', severity: 'error', message: 'Callback has no route', hint: 'Move the route' }],
    });
    emitter.emit('validation:complete', { passed: false, issueCount: 1, durationMs: 1 });
    emitter.emit('complete', { success: true, summary: 'AuthKit is set up.' });
    await adapter.stop();

    const scrollback = afterExit();
    expect(scrollback).not.toContain('pnpm add');
    expect(scrollback).not.toContain('app/callback/route.ts');
    expect(scrollback).not.toContain('Phase 2');
    // Warnings and errors from inside the agent's run stay.
    expect(scrollback).toContain('The build printed a warning');
    expect(scrollback).toContain('Agent completed');
    expect(scrollback).toContain("The agent's step-by-step log is in the installer log");
    // Everything after the agent stays, in order.
    const order = ['Agent completed', 'Callback has no route', 'Hint: Move the route', 'Validation found 1 issue(s)'];
    const at = order.map((text) => scrollback.indexOf(text));
    expect(at.every((i, n) => i > -1 && (n === 0 || i > at[n - 1]))).toBe(true);
    expect(scrollback).toContain('WorkOS AuthKit Installed');
  });

  it('restores the terminal from the exit hook when the process exits without stop()', async () => {
    await adapter.start();
    const hooks = process.listeners('exit');
    const hook = hooks.at(-1) as () => void;
    hook();
    expect(stdout.output().endsWith(LEAVE_FULLSCREEN) || stdout.output().includes(LEAVE_FULLSCREEN)).toBe(true);
    expect(getUiHost()).toBeNull();
    expect(process.listeners('exit')).not.toContain(hook);
    await adapter.stop(); // no-op
    expect(stdout.output().split(LEAVE_FULLSCREEN).length).toBe(2);
  });

  it('undoes a start that fails partway, leaving nothing hijacked', async () => {
    const exitHooks = process.listeners('exit').length;
    vi.spyOn(CLIAdapter.prototype, 'start').mockRejectedValueOnce(new Error('boom'));
    await expect(adapter.start()).rejects.toThrow('boom');
    expect(getUiHost()).toBeNull();
    expect(console.log).toBe(originalLog);
    expect(process.listeners('exit').length).toBe(exitHooks);
    expect(stdout.output()).toContain(LEAVE_FULLSCREEN);
  });

  it('resolves a question nobody answered with CANCEL when the run stops', async () => {
    await adapter.start();
    const answer = ui.confirm({ message: 'Still there?' });
    await waitFor(() => expect(frame()).toContain('? Still there?'));
    await adapter.stop();
    expect(isCancel(await answer)).toBe(true);
    expect(afterExit()).toContain('✗ Still there? cancelled');
  });

  it('answers CANCEL when the question is aborted by its signal', async () => {
    await adapter.start();
    const controller = new AbortController();
    const answer = ui.select({ message: 'Pick one', options: [{ value: 'a' }], signal: controller.signal });
    await waitFor(() => expect(frame()).toContain('? Pick one'));
    controller.abort();
    expect(await answer).toBe(CANCEL);
    await waitFor(() => expect(frame()).not.toContain('? Pick one'));
  });
});
