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

    expect(requests).toEqual([
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
