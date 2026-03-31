import { describe, it, expect, vi } from 'vitest';
import yargs from 'yargs';
import { registerSubcommand } from './register-subcommand.js';

describe('registerSubcommand', () => {
  it('passes original usage as command, enriched usage via .usage()', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'create',
      'Create a resource',
      (y) => y.options({ name: { type: 'string', demandOption: true, describe: 'Name' } }),
      async () => {},
    );

    // Command string should be the original usage (no --options appended)
    expect(commandSpy).toHaveBeenCalledWith('create', 'Create a resource', expect.any(Function), expect.any(Function));

    // The enriched builder should set .usage() with the enriched string
    const wrappedBuilder = commandSpy.mock.calls[0]![2] as (y: yargs.Argv) => yargs.Argv;
    const probe = yargs([]);
    const usageSpy = vi.spyOn(probe, 'usage');
    wrappedBuilder(probe);
    expect(usageSpy).toHaveBeenCalledWith(expect.stringContaining('--name <string>'));
  });

  it('enriches usage with multiple required options', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'send',
      'Send an invitation',
      (y) =>
        y.options({
          email: { type: 'string', demandOption: true, describe: 'Email' },
          'org-id': { type: 'string', demandOption: true, describe: 'Org ID' },
        }),
      async () => {},
    );

    // Command string is plain
    const cmdArg = commandSpy.mock.calls[0]![0] as string;
    expect(cmdArg).toBe('send');

    // Usage contains enriched options
    const wrappedBuilder = commandSpy.mock.calls[0]![2] as (y: yargs.Argv) => yargs.Argv;
    const probe = yargs([]);
    const usageSpy = vi.spyOn(probe, 'usage');
    wrappedBuilder(probe);
    const usageStr = usageSpy.mock.calls[0]![0] as string;
    expect(usageStr).toContain('--email <string>');
    expect(usageStr).toContain('--org-id <string>');
  });

  it('leaves usage unchanged when no required options', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'list',
      'List resources',
      (y) => y.options({ limit: { type: 'number' }, after: { type: 'string' } }),
      async () => {},
    );

    expect(commandSpy).toHaveBeenCalledWith('list', 'List resources', expect.any(Function), expect.any(Function));
  });

  it('preserves positional args in command, appends required options to usage', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'remove <name>',
      'Remove a resource',
      (y) => y.options({ force: { type: 'boolean', demandOption: true, describe: 'Force removal' } }),
      async () => {},
    );

    // Command retains positionals
    const cmdArg = commandSpy.mock.calls[0]![0] as string;
    expect(cmdArg).toBe('remove <name>');

    // Usage has both positionals and enriched options
    const wrappedBuilder = commandSpy.mock.calls[0]![2] as (y: yargs.Argv) => yargs.Argv;
    const probe = yargs([]);
    const usageSpy = vi.spyOn(probe, 'usage');
    wrappedBuilder(probe);
    const usageStr = usageSpy.mock.calls[0]![0] as string;
    expect(usageStr).toContain('remove <name>');
    expect(usageStr).toContain('--force <boolean>');
  });

  it('filters out help and version from enriched options', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'get',
      'Get a resource',
      (y) => y.options({ id: { type: 'string', demandOption: true, describe: 'ID' } }),
      async () => {},
    );

    const wrappedBuilder = commandSpy.mock.calls[0]![2] as (y: yargs.Argv) => yargs.Argv;
    const probe = yargs([]);
    const usageSpy = vi.spyOn(probe, 'usage');
    wrappedBuilder(probe);
    const usageStr = usageSpy.mock.calls[0]![0] as string;
    expect(usageStr).not.toContain('--help');
    expect(usageStr).not.toContain('--version');
    expect(usageStr).toContain('--id <string>');
  });

  it('handles number type option', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'set',
      'Set a value',
      (y) => y.options({ count: { type: 'number', demandOption: true, describe: 'Count' } }),
      async () => {},
    );

    expect(commandSpy).toHaveBeenCalledWith('set', 'Set a value', expect.any(Function), expect.any(Function));

    const wrappedBuilder = commandSpy.mock.calls[0]![2] as (y: yargs.Argv) => yargs.Argv;
    const probe = yargs([]);
    const usageSpy = vi.spyOn(probe, 'usage');
    wrappedBuilder(probe);
    expect(usageSpy).toHaveBeenCalledWith(expect.stringContaining('--count <number>'));
  });

  it('returns the parent yargs instance', () => {
    const parent = yargs([]);
    const result = registerSubcommand(
      parent,
      'test',
      'Test',
      (y) => y,
      async () => {},
    );
    expect(result).toBe(parent);
  });

  it('falls back to unenriched usage when builder throws', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'broken',
      'Broken command',
      () => {
        throw new Error('boom');
      },
      async () => {},
    );

    expect(commandSpy).toHaveBeenCalledWith('broken', 'Broken command', expect.any(Function), expect.any(Function));
  });
});
