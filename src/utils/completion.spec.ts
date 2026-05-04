import { describe, it, expect } from 'vitest';
import { generateCompletions, generateShellScript, SUPPORTED_SHELLS } from './completion.js';

describe('generateCompletions', () => {
  it('returns top-level commands for empty input', () => {
    const result = generateCompletions(['']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('auth');
    expect(names).toContain('env');
    expect(names).toContain('organization');
    expect(names).toContain('completion');
    expect(names).toContain('doctor');
  });

  it('filters commands by partial prefix', () => {
    const result = generateCompletions(['or']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('organization');
    expect(names).toContain('org-domain');
    expect(names).not.toContain('auth');
  });

  it('returns subcommands when parent is given', () => {
    const result = generateCompletions(['env', '']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('add');
    expect(names).toContain('remove');
    expect(names).toContain('switch');
    expect(names).toContain('list');
    expect(names).toContain('claim');
  });

  it('returns options when partial starts with -', () => {
    const result = generateCompletions(['doctor', '--']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('--verbose');
    expect(names).toContain('--fix');
    expect(names).toContain('--json');
  });

  it('excludes used options', () => {
    const result = generateCompletions(['doctor', '--verbose', '--']);
    const names = result.completions.map((c) => c.name);
    expect(names).not.toContain('--verbose');
    expect(names).toContain('--fix');
  });

  it('sets NO_FILE_COMP directive', () => {
    const result = generateCompletions(['']);
    expect(result.directive).toBe(4);
  });

  it('normalizes flat compound names into virtual parent (auth)', () => {
    const result = generateCompletions(['auth', '']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('login');
    expect(names).toContain('logout');
    expect(names).toContain('status');
  });

  it('completes nested subcommands (config redirect)', () => {
    const result = generateCompletions(['config', '']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('redirect');
    expect(names).toContain('cors');
    expect(names).toContain('homepage-url');
  });

  it('handles two-level deep subcommands (config redirect add)', () => {
    const result = generateCompletions(['config', 'redirect', '']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('add');
  });

  it('skips option values for non-boolean options', () => {
    const result = generateCompletions(['doctor', '--install-dir', '/tmp/foo', '--']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('--verbose');
    expect(names).not.toContain('--install-dir');
  });

  it('does not skip next word after boolean options', () => {
    const result = generateCompletions(['doctor', '--verbose', 'unknownword', '--']);
    const names = result.completions.map((c) => c.name);
    expect(names).not.toContain('--verbose');
  });

  it('returns top-level commands for completely empty args', () => {
    const result = generateCompletions([]);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('auth');
    expect(names.length).toBeGreaterThan(0);
  });

  it('returns options and subcommands when unknown word precedes partial', () => {
    const result = generateCompletions(['env', 'nonexistent', '']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('--json');
  });

  it('includes descriptions in completions', () => {
    const result = generateCompletions(['']);
    const doctor = result.completions.find((c) => c.name === 'doctor');
    expect(doctor).toBeDefined();
    expect(doctor!.description).toBeTruthy();
    expect(doctor!.description.length).toBeGreaterThan(0);
  });

  it('filters options by partial prefix', () => {
    const result = generateCompletions(['doctor', '--ver']);
    const names = result.completions.map((c) => c.name);
    expect(names).toContain('--verbose');
    expect(names).toContain('--version');
    expect(names).not.toContain('--fix');
  });

  it('does not complete hidden commands absent from registry', () => {
    const result = generateCompletions(['']);
    const names = result.completions.map((c) => c.name);
    expect(names).not.toContain('emulate');
    expect(names).not.toContain('dashboard');
    expect(names).not.toContain('debug');
  });
});

describe('generateShellScript', () => {
  for (const shell of SUPPORTED_SHELLS) {
    it(`generates script for ${shell}`, () => {
      const script = generateShellScript(shell, 'workos');
      expect(script).toContain('workos');
      expect(script).toContain('--get-yargs-completions');
    });
  }

  it('throws for unsupported shell', () => {
    expect(() => generateShellScript('cmd', 'workos')).toThrow('Unsupported shell');
  });
});
