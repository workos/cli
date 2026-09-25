import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { createElement } from 'react';
import { render, type Instance } from 'ink';
import chalk from 'chalk';
import { createInstallerEventEmitter } from '../lib/events.js';
import { CANCEL, type UiPromptRequest } from '../utils/ui.js';
import { InstallerApp } from './App.js';
import { loadInstallerContent } from './content/index.js';
import { createRunModel } from './model/run-model.js';
import { compactLogoRows, LOGO_MASK } from '../utils/logomark.js';
import { glyphs } from './theme.js';
import stringWidth from 'string-width';
import { FakeStdin, FakeStdout, KEY, settle, stripAnsi, waitFor } from './ink-streams.test-utils.js';

const content = loadInstallerContent();
const BLURPLE_BG = '\x1b[48;2;99;99;241m';

let savedLevel: typeof chalk.level;
beforeAll(() => {
  savedLevel = chalk.level;
  chalk.level = 3; // truecolor, so the logo's background cells are visible in frames
});
afterAll(() => {
  chalk.level = savedLevel;
});

let instance: Instance | undefined;
afterEach(() => {
  instance?.unmount();
  instance = undefined;
});

function mount(columns: number, rows: number, extra: { answer?: (v: unknown) => void; interrupt?: () => void } = {}) {
  const emitter = createInstallerEventEmitter();
  const model = createRunModel({ emitter, content, cwd: '/work/my-app', now: new Date('2026-09-24T12:00:00Z') });
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const answer = extra.answer ?? vi.fn();
  const interrupt = extra.interrupt ?? vi.fn();
  instance = render(
    createElement(InstallerApp, { model, answer, interrupt, projectName: 'my-app', tipIntervalMs: 60_000 }),
    {
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    },
  );
  return { emitter, model, stdout, stdin, answer, interrupt };
}

/** Drive a realistic slice of a run through the model. */
function progress(emitter: ReturnType<typeof createInstallerEventEmitter>) {
  emitter.emit('state:enter', { state: 'authenticating' });
  emitter.emit('auth:checking', {});
  emitter.emit('auth:success', {});
  emitter.emit('state:exit', { state: 'authenticating' });
  emitter.emit('state:enter', { state: 'scaffold' });
  emitter.emit('state:exit', { state: 'scaffold' });
  emitter.emit('state:enter', { state: 'preparing' });
  emitter.emit('detection:complete', { integration: 'nextjs' });
  emitter.emit('state:exit', { state: 'preparing' });
  emitter.emit('state:enter', { state: 'gatheringCredentials' });
  emitter.emit('state:exit', { state: 'gatheringCredentials' });
  emitter.emit('state:enter', { state: 'configuring' });
  emitter.emit('state:exit', { state: 'configuring' });
  emitter.emit('state:enter', { state: 'runningAgent' });
  emitter.emit('agent:start', {});
  emitter.emit('file:write', { path: '/work/my-app/app/callback/route.ts', content: '' });
}

function frameAt(stdout: FakeStdout, match?: string): string {
  return stripAnsi(stdout.lastFrame(match));
}

describe.each([
  [80, 24],
  [120, 40],
])('full-screen installer at %i×%i', (columns, rows) => {
  it('shows the logo, task list, walkthrough, and a tip or announcement', async () => {
    const { emitter, stdout } = mount(columns, rows);
    progress(emitter);

    await waitFor(() => expect(frameAt(stdout)).toContain('Created app/callback/route.ts'));
    const raw = stdout.lastFrame();
    const frame = stripAnsi(raw);
    const lines = frame.split('\n');

    // Header: title, detected framework and project.
    expect(frame).toContain('WorkOS AuthKit installer');
    expect(frame).toContain('Next.js · my-app');

    // Logo: half-block glyphs when short, blurple cells when there's room.
    if (rows < 36) {
      for (const row of compactLogoRows()) expect(frame).toContain(row);
    } else {
      // Every logo row paints blurple cells.
      const painted = raw.split('\n').filter((line) => line.includes(BLURPLE_BG));
      expect(painted.length).toBe(LOGO_MASK.length);
    }

    if (columns >= 100 && rows >= 30) {
      // Room for both: walkthrough on the left, checklist on the right.
      expect(frame).toMatch(/✔ Sign in to WorkOS/);
      expect(frame).toMatch(/✔ Look over your project/);
      expect(frame).toContain(content.tasks.install.activeLabel!);
      expect(frame).toMatch(/○ Wrap up/);
      expect(frame).toMatch(/○ Complete your first sign-up/);
      expect(frame).toContain('4 of 6 done');
      const heads = lines.find((l) => l.includes('Tasks'))!;
      expect(heads.indexOf("What's happening")).toBeGreaterThan(-1);
      expect(heads.indexOf('Tasks')).toBeGreaterThan(heads.indexOf("What's happening"));
    } else {
      // Too small for both: the walkthrough keeps the room, the checklist is one line.
      expect(frame).not.toContain('Tasks');
      expect(frame).toContain(`${content.tasks.install.activeLabel} · 4 of 6 done`);
    }

    // Walkthrough, in plain English.
    expect(frame).toContain("What's happening");
    expect(frame).toContain('This is a Next.js app.');

    // Tips & news: the first card is an announcement.
    expect(frame).toContain(content.announcements[0].title);

    // Fits the screen: one row short, nothing wider than the terminal.
    expect(lines.length).toBeLessThanOrEqual(rows);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns);

    // Margins: a blank row on top, and one clear column on each side.
    expect(lines[0].trim()).toBe('');
    expect(lines[1].trim()).not.toBe('');
    for (const line of lines.filter((l) => l.trim())) {
      expect(line.startsWith(' '), line).toBe(true);
      expect([...line.trimEnd()].length, line).toBeLessThanOrEqual(columns - 1);
    }
  });
});

describe.each([
  [80, 24],
  [120, 40],
])('with a question open at %i×%i', (columns, rows) => {
  const questions: UiPromptRequest[] = [
    { kind: 'confirm', message: 'This directory is empty. Scaffold a new Next.js app with AuthKit here?' },
    {
      kind: 'select',
      message: 'Which WorkOS environment should this install use?',
      options: Array.from({ length: 12 }, (_, i) => ({ value: i, label: `Environment ${i + 1}`, hint: 'staging' })),
    },
    { kind: 'text', message: 'Enter your WorkOS Client ID:', placeholder: 'client_...' },
    {
      kind: 'confirm',
      message: 'Continue anyway?',
      initialValue: false,
      context: [
        {
          kind: 'warn',
          message: 'You have uncommitted or untracked files:',
          rendered: '! You have uncommitted or untracked files:',
          stream: 'stdout',
        },
        ...['README.md', 'next.config.ts', 'package.json', 'src/', 'tsconfig.json'].map((f) => ({
          kind: 'info' as const,
          message: `  - ${f}`,
          rendered: `  - ${f}`,
          stream: 'stdout' as const,
        })),
        { kind: 'info', message: '  ... and 2 more', rendered: '  ... and 2 more', stream: 'stdout' },
      ],
    },
  ];

  it.each(questions.map((q) => [q.kind, q] as const))(
    'keeps a %s prompt and the status line on screen',
    async (_, question) => {
      const { emitter, model, stdout } = mount(columns, rows);
      progress(emitter);
      model.setPrompt(question);
      await waitFor(() => expect(frameAt(stdout)).toContain(question.message));
      const lines = frameAt(stdout).split('\n');
      expect(lines.length).toBeLessThanOrEqual(rows - 1);
      expect(lines[0].trim()).toBe('');
      expect(lines.at(-1)).toMatch(/esc cancel/);
      if (question.context) {
        // The question and its answer line always fit; context above it may collapse.
        const ask = lines.findIndex((l) => l.includes('? Continue anyway?'));
        expect(ask).toBeGreaterThan(-1);
        expect(lines[ask + 1]).toContain('y/N');
        expect(lines[ask - 1]).toMatch(/… \d+ more|\.\.\. and 2 more/);
        expect(frameAt(stdout)).toContain('! You have uncommitted or untracked files:');
      }
      for (const line of lines) expect([...line].length).toBeLessThanOrEqual(columns);
      // However tight, the task in progress stays in view.
      expect(frameAt(stdout)).toContain(content.tasks.install.activeLabel!);
    },
  );
});

describe('checklist', () => {
  function configuring(emitter: ReturnType<typeof createInstallerEventEmitter>) {
    emitter.emit('state:enter', { state: 'authenticating' });
    emitter.emit('state:exit', { state: 'authenticating' });
    emitter.emit('state:enter', { state: 'preparing' });
    emitter.emit('state:exit', { state: 'preparing' });
    emitter.emit('state:enter', { state: 'gatheringCredentials' });
    emitter.emit('state:exit', { state: 'gatheringCredentials' });
    emitter.emit('state:enter', { state: 'configuring' });
    for (const step of ['env-vars', 'redirect-uri', 'cors-origin'] as const) {
      emitter.emit('config:step', { step, status: 'started' });
    }
    emitter.emit('config:step', { step: 'env-vars', status: 'done' });
    emitter.emit('config:step', { step: 'redirect-uri', status: 'done' });
  }

  it("expands Configure WorkOS into the dashboard's items, indented under it", async () => {
    const { emitter, stdout } = mount(120, 40);
    configuring(emitter);
    await waitFor(() => expect(frameAt(stdout)).toContain('Set CORS origin'));
    const lines = frameAt(stdout).split('\n');
    const at = (text: string) => lines.findIndex((l) => l.includes(text));
    const col = (text: string) => lines[at(text)].indexOf(text);

    expect(at('Configuring WorkOS')).toBeGreaterThan(-1);
    const items = ['Add environment variables', 'Set redirect URI', 'Set CORS origin'];
    items.forEach((item, i) => expect(at(item), item).toBe(at('Configuring WorkOS') + 1 + i));
    // Indented one level under the parent.
    expect(col('Add environment variables')).toBe(col('Configuring WorkOS') + 2);
    expect(lines[at('Add environment variables')]).toMatch(/✔ Add environment variables/);
    expect(lines[at('Set CORS origin')]).not.toMatch(/✔ Set CORS origin/);
  });

  it('names the running sub-step on the progress line when the terminal is small', async () => {
    const { emitter, stdout } = mount(80, 24);
    configuring(emitter);
    await waitFor(() =>
      expect(frameAt(stdout)).toContain(`${content.tasks.configure.activeLabel} · Set CORS origin · 3 of 6 done`),
    );
  });

  it('connects the app URLs after the agent and flags the ones to check in the dashboard', async () => {
    const { emitter, stdout } = mount(120, 40);
    emitter.emit('state:enter', { state: 'runningAgent' });
    for (const step of ['redirect-uri', 'initiate-login-uri', 'sign-out-uri'] as const) {
      emitter.emit('app-urls:step', { step, status: 'started' });
    }
    emitter.emit('app-urls:step', { step: 'redirect-uri', status: 'done' });
    emitter.emit('app-urls:step', { step: 'sign-out-uri', status: 'skipped', detail: 'Not verified.' });
    await waitFor(() => expect(frameAt(stdout)).toContain('! Set sign-out URI'));
    const frame = frameAt(stdout);
    expect(frame).toContain(content.tasks['app-urls'].activeLabel!);
    expect(frame).toMatch(/✔ Set redirect URI/);
    expect(frame).toContain('Check in the WorkOS dashboard: set sign-out URI. Not verified.');
  });

  it("doesn't say all done on the small-terminal line while a setting needs a look", async () => {
    const { emitter, stdout } = mount(80, 24);
    emitter.emit('state:enter', { state: 'runningAgent' });
    emitter.emit('app-urls:step', { step: 'sign-out-uri', status: 'started' });
    emitter.emit('app-urls:step', { step: 'sign-out-uri', status: 'skipped', detail: 'Not verified.' });
    emitter.emit('state:exit', { state: 'runningAgent' });
    emitter.emit('state:enter', { state: 'postInstall' });
    emitter.emit('state:enter', { state: 'complete' });
    await waitFor(() =>
      expect(frameAt(stdout)).toContain('! Check your WorkOS settings · → Complete your first sign-up'),
    );
    expect(frameAt(stdout)).not.toContain('All done');
  });

  it('ends on the first sign-up as the next step', async () => {
    for (const [columns, rows, expected] of [
      [120, 40, '→ Complete your first sign-up'],
      [80, 24, '✔ All done · → Complete your first sign-up'],
    ] as const) {
      const { emitter, stdout } = mount(columns, rows);
      emitter.emit('state:enter', { state: 'runningAgent' });
      emitter.emit('state:exit', { state: 'runningAgent' });
      emitter.emit('state:enter', { state: 'postInstall' });
      emitter.emit('state:enter', { state: 'complete' });
      await waitFor(() => expect(frameAt(stdout)).toContain(expected));
      instance?.unmount();
    }
  });

  it.each([
    [100, 30, true],
    [99, 40, false],
    [120, 29, false],
  ])('at %i×%i shows the checklist beside the walkthrough: %s', async (columns, rows, sideBySide) => {
    const { emitter, stdout } = mount(columns, rows);
    progress(emitter);
    await waitFor(() => expect(frameAt(stdout)).toContain("What's happening"));
    expect(frameAt(stdout).includes('Tasks')).toBe(sideBySide);
  });
});

describe('full-screen installer interaction', () => {
  it('asks a confirm inline and answers with y', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({ kind: 'confirm', message: 'Commit the changes?', initialValue: true });

    await waitFor(() => expect(frameAt(stdout)).toContain('? Commit the changes?'));
    expect(frameAt(stdout)).toContain('Y/n');
    stdin.press('y');
    await waitFor(() => expect(answer).toHaveBeenCalledWith(true));
  });

  it('shows what the question is about right above it', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({
      kind: 'confirm',
      message: 'Continue anyway?',
      initialValue: false,
      context: [
        {
          kind: 'warn',
          message: 'You have uncommitted or untracked files:',
          rendered: '! You have uncommitted or untracked files:',
          stream: 'stdout',
        },
        { kind: 'info', message: '  src/app/page.tsx', rendered: '  src/app/page.tsx', stream: 'stdout' },
        { kind: 'info', message: '  ... and 5 more', rendered: '  ... and 5 more', stream: 'stdout' },
      ],
    });

    await waitFor(() => expect(frameAt(stdout)).toContain('? Continue anyway?'));
    const lines = frameAt(stdout).split('\n');
    const at = (text: string) => lines.findIndex((l) => l.includes(text));
    expect(at('! You have uncommitted or untracked files:')).toBeGreaterThan(-1);
    expect(at('src/app/page.tsx')).toBe(at('! You have uncommitted') + 1);
    expect(at('... and 5 more')).toBe(at('src/app/page.tsx') + 1);
    expect(at('? Continue anyway?')).toBe(at('... and 5 more') + 1);
    expect(lines.at(-1)).toMatch(/esc cancel/);
    stdin.press('n');
    await waitFor(() => expect(answer).toHaveBeenCalledWith(false));
  });

  it('confirms the default on enter and declines with n', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({ kind: 'confirm', message: 'Continue anyway?', initialValue: false });
    await waitFor(() => expect(frameAt(stdout)).toContain('y/N'));
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenLastCalledWith(false));
    stdin.press('n');
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
  });

  it('asks a select inline, starting on the initial value and skipping disabled options', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    const request: UiPromptRequest = {
      kind: 'select',
      message: 'You are on main. Create a feature branch?',
      options: [
        { value: 'create', label: 'Create feat/add-workos-authkit' },
        { value: 'locked', label: 'Use a locked branch', disabled: 'not allowed' },
        { value: 'continue', label: 'Continue on current branch' },
        { value: 'cancel', label: 'Cancel' },
      ],
      initialValue: 'continue',
    };
    model.setPrompt(request);

    await waitFor(() => expect(frameAt(stdout)).toContain('› Continue on current branch'));
    expect(frameAt(stdout)).toContain('Use a locked branch  not allowed');
    stdin.press(KEY.up); // skips the disabled option
    await waitFor(() => expect(frameAt(stdout)).toContain('› Create feat/add-workos-authkit'));
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('create'));
  });

  it('starts a select on the first selectable option when the initial value is missing or disabled', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({
      kind: 'select',
      message: 'Pick an environment',
      options: [
        { value: 'locked', label: 'Locked', disabled: true },
        { value: 'staging', label: 'Staging' },
      ],
      initialValue: 'locked',
    });
    await waitFor(() => expect(frameAt(stdout)).toContain('› Staging'));
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('staging'));
  });

  it('validates text input before answering', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({
      kind: 'text',
      message: 'Enter your WorkOS Client ID:',
      placeholder: 'client_...',
      validate: (v) => (v.startsWith('client_') ? undefined : 'Client ID should start with "client_"'),
    });

    await waitFor(() => expect(frameAt(stdout)).toContain('Enter your WorkOS Client ID:'));
    // Wait for each keystroke to land before the next, as a person typing would.
    stdin.press('oops');
    await waitFor(() => expect(frameAt(stdout)).toContain('› oops'));
    await settle();
    stdin.press(KEY.enter);
    await waitFor(() => expect(frameAt(stdout)).toContain('✗ Client ID should start with "client_"'));
    expect(answer).not.toHaveBeenCalled();

    for (let i = 4; i > 0; i--) {
      stdin.press('\x7f'); // backspace
      await waitFor(() => expect(frameAt(stdout)).toContain(`› ${'oops'.slice(0, i - 1)}`));
      await settle();
    }
    stdin.press('client_123');
    await waitFor(() => expect(frameAt(stdout)).toContain('› client_123'));
    await settle();
    // Typing clears the error.
    expect(frameAt(stdout)).not.toContain('should start with');
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('client_123'));
  });

  it('edits by character, so an emoji is one step', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({ kind: 'text', message: 'Team name?' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Team name?'));
    for (const key of ['a', '😀', 'b', KEY.left, '\x7f', KEY.enter]) stdin.press(key);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('ab'));
  });

  it("ignores keys that arrive as escape sequences Ink doesn't name", async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({ kind: 'text', message: 'Team name?' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Team name?'));
    for (const key of ['a', '\x1b[H', '\x1b[F', 'b', KEY.enter]) stdin.press(key);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('ab'));
  });

  it('shows a validator that throws as the error, instead of crashing', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({
      kind: 'text',
      message: 'Client ID?',
      validate: async () => {
        throw new Error('Could not check that client ID');
      },
    });
    await waitFor(() => expect(frameAt(stdout)).toContain('Client ID?'));
    stdin.press('client_1\r');
    await waitFor(() => expect(frameAt(stdout)).toContain('✗ Could not check that client ID'));
    expect(answer).not.toHaveBeenCalled();
  });

  it('masks password input', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    model.setPrompt({ kind: 'password', message: 'Enter your WorkOS API Key:' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Enter your WorkOS API Key:'));
    stdin.press('sk_secret');
    await waitFor(() => expect(frameAt(stdout)).toContain('*********'));
    expect(frameAt(stdout)).not.toContain('sk_secret');
    await settle();
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith('sk_secret'));
  });

  // Helpers for the horizontal-viewport regression tests below.
  const inputRow = (stdout: FakeStdout) =>
    frameAt(stdout)
      .split('\n')
      .find((l) => l.includes(glyphs.pointer)) ?? '';
  const bodyRows = (stdout: FakeStdout) =>
    frameAt(stdout)
      .split('\n')
      .filter((l) => !l.includes(glyphs.pointer));

  it.each(['text', 'password'] as const)('keeps a long %s value on one row', async (kind) => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(80, 24, { answer });
    model.setPrompt({ kind, message: 'Paste a token:' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Paste a token:'));

    const long = `START-${'abcdefghij'.repeat(20)}-END`;
    const visibleTail = kind === 'password' ? '*'.repeat(10) : long.slice(-10);
    stdin.press(long);
    // The freshly typed tail stays visible next to the cursor…
    await waitFor(() => expect(inputRow(stdout)).toContain(visibleTail));
    await settle();
    // …the input never wraps past the 80-column budget…
    expect(inputRow(stdout).length).toBeLessThanOrEqual(80);
    // …and the value never spills onto another line.
    expect(bodyRows(stdout).some((l) => l.includes(kind === 'password' ? '**********' : 'abcdefghij'))).toBe(false);
    if (kind === 'password') expect(frameAt(stdout)).not.toContain('abcdefghij');

    // The full value is submitted intact despite only a window being shown.
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith(long));
  });

  it('scrolls the viewport back to the start when the cursor moves home', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(80, 24, { answer });
    model.setPrompt({ kind: 'text', message: 'Token?' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Token?'));
    const long = `START-${'0123456789'.repeat(12)}-END`;
    stdin.press(long);
    await waitFor(() => expect(inputRow(stdout)).toContain('-END'));
    expect(inputRow(stdout)).not.toContain('START-');
    for (let i = 0; i < long.length; i++) stdin.press(KEY.left);
    await waitFor(() => expect(inputRow(stdout)).toContain('START-'));
    expect(inputRow(stdout)).not.toContain('-END');
    expect(inputRow(stdout).length).toBeLessThanOrEqual(80);
    stdin.press('X');
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith(`X${long}`));
  });

  it('clips a long placeholder to one row', async () => {
    const { model, stdout } = mount(80, 24);
    model.setPrompt({ kind: 'text', message: 'Path?', placeholder: 'x'.repeat(200) });
    await waitFor(() => expect(frameAt(stdout)).toContain('Path?'));
    await settle();
    expect(inputRow(stdout).length).toBeLessThanOrEqual(80);
    expect(bodyRows(stdout).some((l) => l.includes('xxxx'))).toBe(false);
  });

  it('measures wide Unicode by display width so it fits one row', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(80, 24, { answer });
    model.setPrompt({ kind: 'text', message: 'Name?' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Name?'));
    const wide = '中'.repeat(100); // each renders two columns → 200 cells
    stdin.press(wide);
    await waitFor(() => expect(inputRow(stdout)).toContain('中'));
    await settle();
    expect(stringWidth(inputRow(stdout))).toBeLessThanOrEqual(80);
    expect(bodyRows(stdout).some((l) => l.includes('中'))).toBe(false);
    stdin.press(KEY.enter);
    await waitFor(() => expect(answer).toHaveBeenCalledWith(wide));
  });

  it('cancels an open prompt with esc or ctrl-c, without interrupting the run', async () => {
    const answer = vi.fn();
    const interrupt = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer, interrupt });
    model.setPrompt({ kind: 'confirm', message: 'Create a pull request?' });
    await waitFor(() => expect(frameAt(stdout)).toContain('Create a pull request?'));

    stdin.press(KEY.escape);
    await waitFor(() => expect(answer).toHaveBeenCalledWith(CANCEL));
    stdin.press(KEY.ctrlC);
    await waitFor(() => expect(answer).toHaveBeenCalledTimes(2));
    expect(answer).toHaveBeenLastCalledWith(CANCEL);
    expect(interrupt).not.toHaveBeenCalled();
  });

  it('interrupts on ctrl-c when no prompt is open', async () => {
    const interrupt = vi.fn();
    const { stdout, stdin } = mount(100, 30, { interrupt });
    await waitFor(() => expect(frameAt(stdout)).toContain('ctrl-c cancel'));
    stdin.press(KEY.ctrlC);
    await waitFor(() => expect(interrupt).toHaveBeenCalledTimes(1));
  });

  it('pages through tips and news with the arrow keys', async () => {
    const { stdout, stdin } = mount(120, 40);
    const total = content.announcements.length + content.tips.filter((t) => !t.frameworks).length;
    await waitFor(() => expect(frameAt(stdout)).toContain(`Tips & news  1/${total}`));
    stdin.press(KEY.right);
    await waitFor(() => expect(frameAt(stdout)).toContain(`Tips & news  2/${total}`));
    expect(frameAt(stdout)).toContain(content.announcements[1].title);
    stdin.press(KEY.left);
    stdin.press(KEY.left);
    await waitFor(() => expect(frameAt(stdout)).toContain(`Tips & news  ${total}/${total}`));
  });

  it('asks the user to enlarge a too-small window but keeps the prompt answerable', async () => {
    const answer = vi.fn();
    const { model, stdout, stdin } = mount(100, 30, { answer });
    stdout.resize(60, 20);
    model.setPrompt({ kind: 'confirm', message: 'Commit the changes?' });
    await waitFor(() => expect(frameAt(stdout, 'Make this window')).toContain('Make this window at least 80×24'));
    expect(frameAt(stdout, 'Make this window')).toContain('Commit the changes?');
    stdin.press('y');
    await waitFor(() => expect(answer).toHaveBeenCalledWith(true));
  });

  it('shows the running status in the status bar', async () => {
    const { model, stdout } = mount(100, 30);
    model.setStatus('Waiting for authentication...');
    await waitFor(() => expect(frameAt(stdout)).toContain('Waiting for authentication...'));
  });
});

describe('run model wiring', () => {
  it('re-renders when the model changes', async () => {
    const { emitter, stdout } = mount(100, 30);
    emitter.emit('branch:created', { branch: 'feat/add-workos-authkit' });
    await waitFor(() => expect(frameAt(stdout)).toContain('I made a new branch, feat/add-workos-authkit'));
  });
});
