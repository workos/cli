import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderStderrNotice } from './box.js';

describe('renderStderrNotice', () => {
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

  it('frames a single line with blank lines above and below, indented two spaces', () => {
    renderStderrNotice('hello');

    expect(errors).toEqual(['', '  hello', '']);
  });

  it('indents every line of a multi-line notice', () => {
    renderStderrNotice('first', 'second');

    expect(errors).toEqual(['', '  first', '  second', '']);
  });

  it('preserves already-styled (ANSI) content verbatim', () => {
    const styled = '\x1b[32m✓\x1b[39m done';
    renderStderrNotice(styled);

    expect(errors[1]).toBe(`  ${styled}`);
  });
});
