import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type chalk from 'chalk';
import { renderStderrBox, wrapAnsiAware } from './box.js';
import { stripAnsii } from './string.js';

// Identity "color" so border/structure assertions read cleanly.
const noColor = ((s: string) => s) as unknown as typeof chalk.yellow;

// Build a self-closing SGR span explicitly. chalk auto-disables color in a
// non-TTY test env, so we synthesize the escapes the way chalk would on a real
// terminal — this keeps the ANSI-handling assertions deterministic.
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;

function withColumns(cols: number, fn: () => void): void {
  const stderrDesc = Object.getOwnPropertyDescriptor(process.stderr, 'columns');
  const stdoutDesc = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  Object.defineProperty(process.stderr, 'columns', { value: cols, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: cols, configurable: true });
  try {
    fn();
  } finally {
    if (stderrDesc) Object.defineProperty(process.stderr, 'columns', stderrDesc);
    else delete (process.stderr as { columns?: number }).columns;
    if (stdoutDesc) Object.defineProperty(process.stdout, 'columns', stdoutDesc);
    else delete (process.stdout as { columns?: number }).columns;
  }
}

describe('wrapAnsiAware', () => {
  it('keeps short text on a single line', () => {
    expect(wrapAnsiAware('hello world', 80)).toEqual(['hello world']);
  });

  it('wraps plain text to the visible width', () => {
    const lines = wrapAnsiAware('one two three four five', 9);
    for (const line of lines) {
      expect(stripAnsii(line).length).toBeLessThanOrEqual(9);
    }
    expect(lines.join(' ')).toBe('one two three four five');
  });

  it('treats a colored span with internal spaces as one atomic token', () => {
    const span = cyan('keep me together');
    const lines = wrapAnsiAware(`run ${span} now please`, 20);
    // The colored span (16 visible chars, with internal spaces) must land on a
    // single line, never split across the wrap boundary.
    const onSameLine = lines.some((l) => l.includes(span));
    expect(onSameLine).toBe(true);
  });

  it('measures width by visible characters, not ANSI bytes', () => {
    const colored = `${cyan('aaa')} ${yellow('bbb')} ${green('ccc')}`;
    const lines = wrapAnsiAware(colored, 7); // "aaa bbb" = 7 visible
    for (const line of lines) {
      expect(stripAnsii(line).length).toBeLessThanOrEqual(7);
    }
    // The ANSI bytes are far longer than 7; proves we wrapped on visible width.
    expect(colored.length).toBeGreaterThan(7);
  });

  it('never returns an empty array', () => {
    expect(wrapAnsiAware('', 10)).toEqual(['']);
  });
});

describe('renderStderrBox', () => {
  let errors: string[];

  beforeEach(() => {
    errors = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a single-line box when content fits (historical layout)', () => {
    withColumns(80, () => renderStderrBox(' hi ', noColor));

    // blank, top, middle, bottom, blank
    expect(errors).toHaveLength(5);
    expect(errors[1]).toBe('  ┌────┐'); // border = visible length of " hi " (4)
    expect(errors[2]).toBe('  │ hi │');
    expect(errors[3]).toBe('  └────┘');
  });

  it('wraps to multiple lines on a narrow terminal without breaking the border', () => {
    const msg = ' WorkOS collects anonymous CLI usage telemetry. Run workos telemetry opt-out to disable it. ';
    withColumns(40, () => renderStderrBox(msg, noColor));

    // No rendered line may exceed the terminal width.
    for (const line of errors) {
      expect(stripAnsii(line).length).toBeLessThanOrEqual(40);
    }

    const top = errors.find((l) => l.includes('┌'))!;
    const bottom = errors.find((l) => l.includes('└'))!;
    const body = errors.filter((l) => l.includes('│'));

    // More than one body line proves it wrapped.
    expect(body.length).toBeGreaterThan(1);

    // Top and bottom borders are the same width, and every body line matches it.
    expect(stripAnsii(top).length).toBe(stripAnsii(bottom).length);
    for (const line of body) {
      expect(stripAnsii(line).length).toBe(stripAnsii(top).length);
    }
  });

  it('preserves the colored command span when wrapping', () => {
    const cmd = cyan('workos telemetry opt-out');
    const msg = ` WorkOS collects anonymous CLI usage telemetry. Run ${cmd} to disable it. `;
    withColumns(44, () => renderStderrBox(msg, noColor));

    const body = errors.filter((l) => l.includes('│')).join('\n');
    expect(body).toContain(cmd); // intact, not split mid-span
  });
});
