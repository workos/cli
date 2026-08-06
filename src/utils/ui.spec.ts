import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
}));

const inquirer = await import('@inquirer/prompts');
const ui = (await import('./ui.js')).default;
const { isCancel, CANCEL, setDashboardMode } = await import('./ui.js');

function namedError(name: string): Error {
  const e = new Error(name);
  e.name = name;
  return e;
}

let stdinTtyDesc: PropertyDescriptor | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  setDashboardMode(false);
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

describe('spinner coordination (AUTH-6732)', () => {
  let stdoutTtyDesc: PropertyDescriptor | undefined;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  const writes = () => writeSpy.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    vi.useFakeTimers();
    // Spinners only animate on a TTY; stub it so the redraw interval runs.
    stdoutTtyDesc = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    writeSpy.mockRestore();
    logSpy.mockRestore();
    if (stdoutTtyDesc) Object.defineProperty(process.stdout, 'isTTY', stdoutTtyDesc);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  it('starting a new spinner retires the previous one (no orphaned interval)', () => {
    const a = ui.spinner();
    a.start('phase A');
    vi.advanceTimersByTime(240);
    expect(writes().some((w) => w.includes('phase A'))).toBe(true);

    writeSpy.mockClear();
    const b = ui.spinner();
    b.start('phase B');
    vi.advanceTimersByTime(240);

    const after = writes();
    expect(after.some((w) => w.includes('phase A'))).toBe(false);
    expect(after.some((w) => w.includes('phase B'))).toBe(true);
    b.stop('done');
  });

  it('a retired spinner handle goes inert — stop()/clear() print nothing', () => {
    const a = ui.spinner();
    a.start('phase A');
    const b = ui.spinner();
    b.start('phase B'); // retires A

    writeSpy.mockClear();
    logSpy.mockClear();
    a.stop('should not print');
    a.clear();
    a.message('should not render');
    vi.advanceTimersByTime(240);

    expect(writes().every((w) => !w.includes('should not'))).toBe(true);
    expect(logSpy).not.toHaveBeenCalled();
    // The live spinner is untouched and keeps animating.
    expect(writes().some((w) => w.includes('phase B'))).toBe(true);
    b.stop('done');
  });

  it('a prompt pauses the active spinner and resumes it after the answer', async () => {
    const s = ui.spinner();
    s.start('Working');
    vi.advanceTimersByTime(160);
    expect(writes().some((w) => w.includes('Working'))).toBe(true);

    let framesDuringPrompt = 0;
    writeSpy.mockClear();
    vi.mocked(inquirer.confirm).mockImplementationOnce(async () => {
      // While the prompt awaits input, the spinner's 80ms redraw must not fire.
      vi.advanceTimersByTime(500);
      framesDuringPrompt = writes().filter((w) => w.includes('Working')).length;
      return true;
    });

    await ui.confirm({ message: 'ok?' });
    expect(framesDuringPrompt).toBe(0);

    writeSpy.mockClear();
    vi.advanceTimersByTime(240);
    expect(writes().some((w) => w.includes('Working'))).toBe(true);
    s.stop('done');
  });

  it('replacing the spinner mid-prompt does not erase the prompt, and the old spinner stays dead', async () => {
    const a = ui.spinner();
    a.start('Working');

    let erasesAtReplace = 0;
    vi.mocked(inquirer.confirm).mockImplementationOnce(async () => {
      writeSpy.mockClear();
      const b = ui.spinner();
      b.start('Next phase'); // retires the paused "Working" spinner
      erasesAtReplace = writes().filter((w) => w.includes('\x1b[2K')).length;
      b.stop('done');
      return true;
    });

    await ui.confirm({ message: 'ok?' });
    // A paused spinner owns no line — retiring it must not wipe the prompt's.
    expect(erasesAtReplace).toBe(0);

    // The prompt's resume() must not resurrect the retired spinner.
    writeSpy.mockClear();
    vi.advanceTimersByTime(500);
    expect(writes().every((w) => !w.includes('Working'))).toBe(true);
  });
});

describe('dashboard mode suppresses output', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => logSpy.mockRestore());

  it('no-ops log/intro/note when dashboard mode is on', () => {
    setDashboardMode(true);
    ui.log.info('hi');
    ui.intro('title');
    ui.note('body');
    expect(logSpy).not.toHaveBeenCalled();
  });

  it('writes when dashboard mode is off', () => {
    setDashboardMode(false);
    ui.log.success('done');
    expect(logSpy).toHaveBeenCalled();
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
