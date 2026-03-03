import { describe, it, expect, vi } from 'vitest';
import yargs from 'yargs';
import { registerSubcommand } from './register-subcommand.js';

describe('registerSubcommand', () => {
  it('enriches usage with one required string option', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'create',
      'Create a resource',
      (y) => y.options({ name: { type: 'string', demandOption: true, describe: 'Name' } }),
      async () => {},
    );

    expect(commandSpy).toHaveBeenCalledWith(
      'create --name <string>',
      'Create a resource',
      expect.any(Function),
      expect.any(Function),
    );
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

    const usageArg = commandSpy.mock.calls[0]![0] as string;
    expect(usageArg).toContain('--email <string>');
    expect(usageArg).toContain('--org-id <string>');
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

  it('preserves positional args and appends required options', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'remove <name>',
      'Remove a resource',
      (y) => y.options({ force: { type: 'boolean', demandOption: true, describe: 'Force removal' } }),
      async () => {},
    );

    const usageArg = commandSpy.mock.calls[0]![0] as string;
    expect(usageArg).toMatch(/^remove <name>/);
    expect(usageArg).toContain('--force <boolean>');
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

    const usageArg = commandSpy.mock.calls[0]![0] as string;
    expect(usageArg).not.toContain('--help');
    expect(usageArg).not.toContain('--version');
    expect(usageArg).toContain('--id <string>');
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

    expect(commandSpy).toHaveBeenCalledWith(
      'set --count <number>',
      'Set a value',
      expect.any(Function),
      expect.any(Function),
    );
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
