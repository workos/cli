import { describe, it, expect } from 'vitest';
import { selectInstallerAdapter, type AdapterSelectionInput } from './select-adapter.js';

const interactive: AdapterSelectionInput = {
  json: false,
  interaction: 'human',
  ci: false,
  stdinTTY: true,
  stdoutTTY: true,
  stderrTTY: true,
  columns: 120,
  rows: 40,
  noTui: false,
  term: 'xterm-256color',
};

describe('selectInstallerAdapter', () => {
  it('uses the full-screen installer for a person at a big-enough terminal', () => {
    expect(selectInstallerAdapter(interactive)).toBe('tui');
    expect(selectInstallerAdapter({ ...interactive, columns: 80, rows: 24 })).toBe('tui');
  });

  it('is headless for JSON output, whatever else is true', () => {
    expect(selectInstallerAdapter({ ...interactive, json: true })).toBe('headless');
    expect(selectInstallerAdapter({ ...interactive, json: true, interaction: 'agent' })).toBe('headless');
  });

  it.each([
    ['agent mode', { interaction: 'agent' as const }],
    ['CI mode', { interaction: 'ci' as const }],
    ['the --ci flag', { ci: true }],
    ['piped stdin', { stdinTTY: false }],
    ['piped stdout', { stdoutTTY: false }],
    ['redirected stderr', { stderrTTY: false }],
    ['--no-tui', { noTui: true }],
    ['TERM=dumb', { term: 'dumb' }],
    ['a narrow terminal', { columns: 79 }],
    ['a short terminal', { rows: 23 }],
    ['an unknown size', { columns: 0, rows: 0 }],
  ])('keeps the plain CLI for %s', (_, change) => {
    expect(selectInstallerAdapter({ ...interactive, ...change })).toBe('cli');
  });
});
