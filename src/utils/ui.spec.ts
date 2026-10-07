import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
}));

const inquirer = await import('@inquirer/prompts');
const ui = (await import('./ui.js')).default;
const uiModule = await import('./ui.js');
const { isCancel, CANCEL, setUiHost } = uiModule;
type UiHost = import('./ui.js').UiHost;
type UiPromptRequest = import('./ui.js').UiPromptRequest;

function namedError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

let stdinTtyDesc: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  setUiHost(null);
  // Prompts route through withPrompt, which refuses to open on a non-TTY stdin.
  // Simulate an interactive terminal so the adapter/cancellation tests exercise
  // the real prompt path (individual tests override this to test the guard).
  stdinTtyDesc = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
});
afterEach(() => {
  if (stdinTtyDesc) Object.defineProperty(process.stdin, 'isTTY', stdinTtyDesc);
  else delete (process.stdin as { isTTY?: boolean }).isTTY;
});

describe('isCancel / CANCEL', () => {
  it('recognizes the CANCEL sentinel and nothing else', () => {
    expect(isCancel(CANCEL)).toBe(true);
    expect(isCancel(false)).toBe(false);
    expect(isCancel('nope')).toBe(false);
    expect(isCancel(Symbol('other'))).toBe(false);
  });
});

describe('prompt adapters (legacy shape → @inquirer)', () => {
  it('confirm forwards message + initialValue→default and the abort signal', async () => {
    vi.mocked(inquirer.confirm).mockResolvedValue(true);
    const controller = new AbortController();

    const result = await ui.confirm({ message: 'ok?', initialValue: false, signal: controller.signal });

    expect(result).toBe(true);
    expect(inquirer.confirm).toHaveBeenCalledWith({ message: 'ok?', default: false }, { signal: controller.signal });
  });

  it('select maps options[{value,label,hint}] → choices[{value,name,description}] and initialValue → default', async () => {
    vi.mocked(inquirer.select).mockResolvedValue('a');

    const result = await ui.select({
      message: 'pick',
      options: [
        { value: 'a', label: 'Option A', hint: 'the first' },
        { value: 'b', label: 'Option B' },
      ],
      initialValue: 'b',
      maxItems: 5,
    });

    expect(result).toBe('a');
    expect(inquirer.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'pick',
        choices: [
          { value: 'a', name: 'Option A', description: 'the first' },
          { value: 'b', name: 'Option B', description: undefined },
        ],
        default: 'b',
        pageSize: 5,
      }),
      expect.anything(),
    );
  });

  it('text converts the validate contract (error string | Error | undefined) → inquirer (string | true)', async () => {
    vi.mocked(inquirer.input).mockResolvedValue('value');

    await ui.text({
      message: 'name',
      validate: (v) => {
        if (v === '') return 'required';
        if (v === 'boom') return new Error('bad value');
        return undefined;
      },
    });

    const passed = vi.mocked(inquirer.input).mock.calls[0][0] as { validate: (v: string) => Promise<boolean | string> };
    await expect(passed.validate('x')).resolves.toBe(true);
    await expect(passed.validate('')).resolves.toBe('required');
    // Error instances are unwrapped to their .message (regression guard).
    await expect(passed.validate('boom')).resolves.toBe('bad value');
  });

  it('text folds placeholder into the message (inquirer has no placeholder)', async () => {
    vi.mocked(inquirer.input).mockResolvedValue('client_123');

    await ui.text({ message: 'Enter your WorkOS Client ID', placeholder: 'client_...' });

    expect(inquirer.input).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Enter your WorkOS Client ID (client_...)' }),
      expect.anything(),
    );
  });

  it('password masks input and adapts validate', async () => {
    vi.mocked(inquirer.password).mockResolvedValue('secret');

    const result = await ui.password({ message: 'key' });

    expect(result).toBe('secret');
    expect(inquirer.password).toHaveBeenCalledWith(expect.objectContaining({ mask: true }), expect.anything());
  });
});

describe('cancellation (inquirer throws → CANCEL sentinel)', () => {
  it('maps ExitPromptError (ctrl-c) to CANCEL', async () => {
    vi.mocked(inquirer.confirm).mockRejectedValue(namedError('ExitPromptError'));
    expect(isCancel(await ui.confirm({ message: 'q' }))).toBe(true);
  });

  it('maps AbortPromptError (signal abort) to CANCEL', async () => {
    vi.mocked(inquirer.select).mockRejectedValue(namedError('AbortPromptError'));
    expect(isCancel(await ui.select({ message: 'q', options: [{ value: 1 }] }))).toBe(true);
  });

  it('maps CancelPromptError to CANCEL', async () => {
    vi.mocked(inquirer.password).mockRejectedValue(namedError('CancelPromptError'));
    expect(isCancel(await ui.password({ message: 'q' }))).toBe(true);
  });

  it('rethrows non-cancel errors', async () => {
    vi.mocked(inquirer.input).mockRejectedValue(new Error('disk full'));
    await expect(ui.text({ message: 'q' })).rejects.toThrow('disk full');
  });
});

describe('prompt coordination (withPrompt)', () => {
  it('refuses to prompt in --json mode (would corrupt machine output)', async () => {
    const { setOutputMode } = await import('./output.js');
    setOutputMode('json');
    try {
      await expect(ui.confirm({ message: 'q' })).rejects.toMatchObject({
        name: 'PromptUnavailableError',
        reason: 'json',
      });
      expect(inquirer.confirm).not.toHaveBeenCalled();
    } finally {
      setOutputMode('human');
    }
  });

  it('refuses to prompt on a non-TTY stdin (would hang forever)', async () => {
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await expect(ui.confirm({ message: 'q' })).rejects.toMatchObject({
      name: 'PromptUnavailableError',
      reason: 'no-tty',
    });
    expect(inquirer.confirm).not.toHaveBeenCalled();
  });

  it('serializes concurrent prompts so two never share stdin at once', async () => {
    const order: string[] = [];
    let resolveFirst!: (v: boolean) => void;
    vi.mocked(inquirer.confirm)
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            order.push('open1');
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async () => {
        order.push('open2');
        return true;
      });

    // Fire two prompts "at once", as the parallel installer state does.
    const p1 = ui.confirm({ message: 'first' });
    const p2 = ui.confirm({ message: 'second' });
    await new Promise((r) => setTimeout(r, 0));

    // Only the first prompt has opened; the second is queued behind it.
    expect(order).toEqual(['open1']);

    resolveFirst(true);
    await Promise.all([p1, p2]);
    expect(order).toEqual(['open1', 'open2']);
  });
});

describe('spinner ownership (AUTH-6732)', () => {
  let write: ReturnType<typeof vi.spyOn>;
  let log: ReturnType<typeof vi.spyOn>;
  let stdoutTty: PropertyDescriptor | undefined;
  const handles: ReturnType<typeof ui.spinner>[] = [];
  const start = (message: string) => {
    const handle = ui.spinner();
    handles.push(handle);
    handle.start(message);
    return handle;
  };
  const output = () => write.mock.calls.map(([chunk]) => String(chunk)).join('');
  const drain = async () => {
    await vi.advanceTimersByTimeAsync(0);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    stdoutTty = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    log = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    handles.splice(0).forEach((handle) => handle.clear());
    setUiHost(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (stdoutTty) Object.defineProperty(process.stdout, 'isTTY', stdoutTty);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it('retires replaced timers and makes all stale operations inert', () => {
    const old = start('old');
    const current = start('current');
    write.mockClear();
    old.message('stale');
    old.stop('stale');
    old.clear();
    old.start('stale');
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(output()).toContain('current');
    expect(output()).not.toMatch(/old|stale/);
    expect(vi.getTimerCount()).toBe(1);
    current.clear();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['resume', 'stop', 'clear'] as const)(
    'suspends new and replaced spinners through queued prompts, then %s',
    async (ending) => {
      let answer!: (value: boolean) => void;
      vi.mocked(inquirer.confirm).mockImplementation(() => new Promise((resolve) => (answer = resolve)));
      const old = start('old');
      const first = ui.confirm({ message: 'first' });
      const second = ui.confirm({ message: 'second' });
      await drain();
      write.mockClear();
      vi.advanceTimersByTime(400);
      const current = start('next');
      old.clear();
      current.message('updated');
      if (ending === 'stop') current.stop('finished');
      if (ending === 'clear') current.clear();
      vi.advanceTimersByTime(400);
      expect(write).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      answer(true);
      await first;
      await drain();
      expect(inquirer.confirm).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(400);
      expect(write).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
      answer(false);
      expect(await second).toBe(false);
      write.mockClear();
      vi.advanceTimersByTime(400);
      expect(output()).not.toContain('old');
      if (ending === 'resume') expect(output()).toContain('updated');
      else expect(write).not.toHaveBeenCalled();
      if (ending === 'stop') expect(log).toHaveBeenCalledWith(expect.stringContaining('finished'));
    },
  );

  it('pauses an existing owner for all ticks and resumes it after the answer', async () => {
    let answer!: (value: boolean) => void;
    vi.mocked(inquirer.confirm).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    start('working');
    const prompt = ui.confirm({ message: 'question' });
    await drain();
    write.mockClear();
    vi.advanceTimersByTime(800);
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    answer(true);
    await prompt;
    vi.advanceTimersByTime(240);
    expect(output()).toContain('working');
    expect(vi.getTimerCount()).toBe(1);
  });

  it('host activation retires terminal animation and host replacement retires status', () => {
    const terminal = start('terminal');
    const oldHost = { line: vi.fn(), status: vi.fn(), prompt: vi.fn() };
    const newHost = { line: vi.fn(), status: vi.fn(), prompt: vi.fn() };
    setUiHost(oldHost);
    expect(vi.getTimerCount()).toBe(0);
    const hosted = start('hosted');
    setUiHost(newHost);
    expect(oldHost.status).toHaveBeenLastCalledWith(null);
    write.mockClear();
    terminal.start('stale terminal');
    hosted.stop('stale host');
    hosted.message('stale host');
    vi.advanceTimersByTime(800);
    expect(write).not.toHaveBeenCalled();
    expect(newHost.status).not.toHaveBeenCalled();
    expect(newHost.line).not.toHaveBeenCalled();
  });

  it('does not animate on non-TTY output or emit any spinner output in JSON mode', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    const nonTty = start('non-TTY');
    nonTty.stop('done');
    expect(write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const { setOutputMode } = await import('./output.js');
    log.mockClear();
    setOutputMode('json');
    try {
      const json = start('json');
      json.message('json update');
      json.stop('json done');
      json.clear();
      expect(log).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      setOutputMode('human');
    }
  });

  it('hands back to the current spinner after a rejected prompt', async () => {
    start('working');
    vi.mocked(inquirer.confirm).mockRejectedValueOnce(new Error('broken'));
    await expect(ui.confirm({ message: 'question' })).rejects.toThrow('broken');
    write.mockClear();
    vi.advanceTimersByTime(400);
    expect(output()).toContain('working');
  });

  it('does not open pre-aborted or cancelled queued prompts', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await ui.confirm({ message: 'moot', signal: controller.signal })).toBe(CANCEL);
    expect(inquirer.confirm).not.toHaveBeenCalled();
  });

  it('protects hosted status from stale handles and retires it at teardown', async () => {
    const status = vi.fn();
    let answer!: (value: unknown) => void;
    setUiHost({ line: vi.fn(), status, prompt: () => new Promise((resolve) => (answer = resolve)) });
    const old = start('old');
    const first = ui.confirm({ message: 'first' });
    const queued = ui.confirm({ message: 'queued' });
    await drain();
    const current = start('current');
    status.mockClear();
    old.stop('stale');
    old.clear();
    old.message('stale');
    old.start('stale');
    expect(status).not.toHaveBeenCalled();
    setUiHost(null);
    answer(CANCEL);
    expect(await first).toBe(CANCEL);
    await drain();
    expect(await queued).toBe(CANCEL);
    current.message('late');
    current.stop('late');
    current.start('late');
    vi.advanceTimersByTime(400);
    expect(write).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(inquirer.confirm).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('UI host', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  function fakeHost(answer: (request: UiPromptRequest) => unknown = () => true) {
    const lines: Array<{ kind: string; message: string; rendered: string; stream: string }> = [];
    const statuses: Array<string | null> = [];
    const requests: UiPromptRequest[] = [];
    const host: UiHost = {
      line: (l) => lines.push({ ...l, rendered: strip(l.rendered) }),
      status: (m) => statuses.push(m),
      prompt: async (request) => {
        requests.push(request);
        return answer(request);
      },
    };
    return { host, lines, statuses, requests };
  }

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });
  afterEach(() => {
    setUiHost(null);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('no longer exposes the removed dashboard-mode flag', () => {
    expect('setDashboardMode' in uiModule).toBe(false);
    expect('isDashboardMode' in uiModule).toBe(false);
  });

  it('prints to the terminal when no host is registered', () => {
    ui.log.success('done');
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(strip(String(logSpy.mock.calls[0][0]))).toBe('  ✓ done');
  });

  it('routes every output helper to the host with its level, and prints nothing', () => {
    const { host, lines } = fakeHost();
    setUiHost(host);

    ui.log.info('plain info');
    ui.log.step('a step');
    ui.log.success('it worked');
    ui.log.warn('careful');
    ui.log.warning('also careful');
    ui.log.error('it broke');
    ui.log.hint('psst');
    ui.log.detail('nested');
    ui.intro('WorkOS', 'installer');
    ui.rows([{ key: 'Client ID', value: 'client_123', status: 'created' }]);
    ui.cancel('Stopped');

    expect(logSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(lines.slice(0, 8)).toEqual([
      { kind: 'info', message: 'plain info', rendered: 'plain info', stream: 'stdout' },
      { kind: 'step', message: 'a step', rendered: '› a step', stream: 'stdout' },
      { kind: 'success', message: 'it worked', rendered: '✓ it worked', stream: 'stdout' },
      { kind: 'warn', message: 'careful', rendered: '! careful', stream: 'stdout' },
      { kind: 'warn', message: 'also careful', rendered: '! also careful', stream: 'stdout' },
      { kind: 'error', message: 'it broke', rendered: '✗ it broke', stream: 'stdout' },
      { kind: 'hint', message: 'psst', rendered: 'psst', stream: 'stdout' },
      { kind: 'detail', message: 'nested', rendered: '  › nested', stream: 'stdout' },
    ]);
    // intro: blank, title line, blank
    expect(lines.slice(8, 11).map((l) => l.rendered)).toEqual(['', 'WorkOS  ·  installer', '']);
    expect(lines[11].rendered).toMatch(/^✓ Client ID {2}client_123 {2}created$/);
    expect(lines[12]).toEqual({ kind: 'plain', message: 'Stopped', rendered: 'Stopped', stream: 'stderr' });
  });

  it('reports spinner progress as status and records the final line', () => {
    const { host, lines, statuses } = fakeHost();
    setUiHost(host);

    const s = ui.spinner();
    s.start('Working');
    s.message('Still working');
    s.stop('Done');
    const failed = ui.spinner();
    failed.start('Pushing');
    failed.stop('Push failed', 1);
    const cleared = ui.spinner();
    cleared.start('Waiting');
    cleared.clear();

    expect(statuses).toEqual(['Working', 'Still working', null, 'Pushing', null, 'Waiting', null]);
    expect(lines).toEqual([
      { kind: 'success', message: 'Done', rendered: '✓ Done', stream: 'stdout' },
      { kind: 'error', message: 'Push failed', rendered: '✗ Push failed', stream: 'stdout' },
    ]);
    // No animation frames were written to the terminal.
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('delegates each prompt kind to the host with the same call shape, not to inquirer', async () => {
    const validate = (v: string) => (v ? undefined : 'required');
    const { host, requests } = fakeHost((r) => (r.kind === 'confirm' ? false : r.kind === 'select' ? 'b' : 'typed'));
    setUiHost(host);

    await expect(ui.confirm({ message: 'Continue?', initialValue: true })).resolves.toBe(false);
    await expect(
      ui.select({
        message: 'Pick',
        options: [{ value: 'a' }, { value: 'b', label: 'B', hint: 'second' }],
        initialValue: 'b',
      }),
    ).resolves.toBe('b');
    await expect(ui.text({ message: 'Name', placeholder: 'client_...', validate })).resolves.toBe('typed');
    await expect(ui.password({ message: 'Key', validate })).resolves.toBe('typed');

    expect(requests.every((request) => request.signal instanceof AbortSignal)).toBe(true);
    expect(requests.map(({ signal: _signal, ...request }) => request)).toEqual([
      { kind: 'confirm', message: 'Continue?', initialValue: true },
      {
        kind: 'select',
        message: 'Pick',
        options: [{ value: 'a' }, { value: 'b', label: 'B', hint: 'second' }],
        initialValue: 'b',
      },
      { kind: 'text', message: 'Name', placeholder: 'client_...', validate },
      { kind: 'password', message: 'Key', validate },
    ]);
    expect(inquirer.confirm).not.toHaveBeenCalled();
    expect(inquirer.select).not.toHaveBeenCalled();
    expect(inquirer.input).not.toHaveBeenCalled();
    expect(inquirer.password).not.toHaveBeenCalled();
  });

  it('passes CANCEL from the host through unchanged', async () => {
    const { host } = fakeHost(() => CANCEL);
    setUiHost(host);
    const answer = await ui.confirm({ message: 'q' });
    expect(isCancel(answer)).toBe(true);
  });

  it('returns CANCEL for an already-aborted signal without opening the host prompt', async () => {
    const { host, requests } = fakeHost();
    setUiHost(host);
    const controller = new AbortController();
    controller.abort();
    const answer = await ui.select({ message: 'q', options: [{ value: 'x' }], signal: controller.signal });
    expect(isCancel(answer)).toBe(true);
    expect(requests).toEqual([]);
  });

  it('keeps the --json and non-TTY guards in front of the host', async () => {
    const { host, requests } = fakeHost();
    setUiHost(host);

    const { setOutputMode } = await import('./output.js');
    setOutputMode('json');
    try {
      await expect(ui.confirm({ message: 'q' })).rejects.toMatchObject({
        name: 'PromptUnavailableError',
        reason: 'json',
      });
    } finally {
      setOutputMode('human');
    }

    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    await expect(ui.text({ message: 'q' })).rejects.toMatchObject({ name: 'PromptUnavailableError', reason: 'no-tty' });
    expect(requests).toEqual([]);
  });

  it('opens host prompts one at a time', async () => {
    const order: string[] = [];
    let resolveFirst!: (v: boolean) => void;
    setUiHost({
      line: () => {},
      status: () => {},
      prompt: (request) => {
        order.push(`open:${request.message}`);
        if (request.message === 'first') return new Promise<boolean>((resolve) => (resolveFirst = resolve));
        return Promise.resolve(true);
      },
    });

    const p1 = ui.confirm({ message: 'first' });
    const p2 = ui.confirm({ message: 'second' });
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['open:first']);

    resolveFirst(true);
    await Promise.all([p1, p2]);
    expect(order).toEqual(['open:first', 'open:second']);
  });

  it('attaches what was printed just before a prompt as its context', async () => {
    const { host, requests } = fakeHost(() => false);
    setUiHost(host);

    ui.log.warn('You have uncommitted or untracked files:');
    ui.log.info('  src/a.ts');
    ui.log.info('');
    ui.log.info('  src/b.ts');
    await ui.confirm({ message: 'Continue anyway?', initialValue: false });

    expect(requests[0].context?.map((l) => [l.kind, l.message])).toEqual([
      ['warn', 'You have uncommitted or untracked files:'],
      ['info', '  src/a.ts'],
      ['info', '  src/b.ts'],
    ]);
  });

  it('does not attach lines printed in an earlier run', async () => {
    const { host, requests } = fakeHost();
    setUiHost(host);

    ui.log.success('Authenticated');
    await new Promise((r) => setTimeout(r, 0));
    await ui.confirm({ message: 'Commit the changes?' });

    expect(requests[0]).not.toHaveProperty('context');
  });

  it('keeps each queued prompt paired with the lines printed before it was called', async () => {
    const opened: UiPromptRequest[] = [];
    let resolveFirst!: (v: unknown) => void;
    setUiHost({
      line: () => {},
      status: () => {},
      prompt: (request) => {
        opened.push(request);
        return opened.length === 1 ? new Promise((r) => (resolveFirst = r)) : Promise.resolve(true);
      },
    });

    ui.log.info('about the first');
    const first = ui.select({ message: 'First?', options: [{ value: 'a' }] });
    ui.log.warn('about the second');
    const second = ui.confirm({ message: 'Second?' });
    await new Promise((r) => setTimeout(r, 0));
    resolveFirst('a');
    await Promise.all([first, second]);

    expect(opened.map((r) => r.context?.map((l) => l.message))).toEqual([['about the first'], ['about the second']]);
  });

  it('never collects context without a host', async () => {
    ui.log.warn('printed to the terminal');
    vi.mocked(inquirer.confirm).mockResolvedValue(true);
    await ui.confirm({ message: 'q' });
    expect(vi.mocked(inquirer.confirm).mock.calls[0][0]).not.toHaveProperty('context');
  });

  it('goes back to the terminal after the host is removed', () => {
    const { host, lines } = fakeHost();
    setUiHost(host);
    ui.log.info('to host');
    setUiHost(null);
    ui.log.info('to terminal');
    expect(lines.map((l) => l.message)).toEqual(['to host']);
    expect(strip(String(logSpy.mock.calls[0][0]))).toBe('  to terminal');
  });
});

describe('flat output helpers', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = () => logSpy.mock.calls.map((c) => strip(String(c[0] ?? '')));
  const indentOf = (l: string) => l.match(/^ */)![0].length;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it('intro renders "Title · subtitle" when a subtitle is given', () => {
    ui.intro('WorkOS', 'AuthKit installer');
    expect(lines().some((l) => l.includes('WorkOS  ·  AuthKit installer'))).toBe(true);
  });

  it('intro renders the title alone (no ·) when no subtitle', () => {
    ui.intro('WorkOS');
    const titleLine = lines().find((l) => l.includes('WorkOS'));
    expect(titleLine).toBeDefined();
    expect(titleLine).not.toContain('·');
  });

  it('log.detail nests one level deeper than a sibling line', () => {
    ui.log.success('parent');
    ui.log.detail('child');
    const out = lines();
    const parent = out.find((l) => l.includes('parent'))!;
    const child = out.find((l) => l.includes('child'))!;
    expect(indentOf(child)).toBeGreaterThan(indentOf(parent));
    expect(child).toContain('›');
  });

  it('rows aligns values to the widest key and appends the status word', () => {
    ui.rows([
      { key: 'Redirect URI', value: 'http://x/cb', status: 'created', statusKind: 'ok' },
      { key: 'CORS', value: 'http://x', status: 'already set' },
    ]);
    const out = lines().filter((l) => l.includes('http'));
    expect(out).toHaveLength(2);
    // Keys padded to the widest key → both value columns start at the same offset.
    expect(out[0].indexOf('http')).toBe(out[1].indexOf('http'));
    expect(out[0]).toContain('created');
    expect(out[1]).toContain('already set');
  });

  it('rows is a no-op for an empty set', () => {
    ui.rows([]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('pill pads the label with a single space on each side', () => {
    expect(strip(ui.pill('WARN', 'warn'))).toBe(' WARN ');
    expect(strip(ui.pill('INFO'))).toBe(' INFO ');
  });
});
