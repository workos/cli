import { describe, it, expect, vi } from 'vitest';
import yargs from 'yargs';
import { registerSubcommand } from './register-subcommand.js';

describe('registerSubcommand', () => {
  it('enriches description with required flag names', () => {
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
      'create',
      'Create a resource (requires --name)',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('enriches description with multiple required flags', () => {
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

    const descArg = commandSpy.mock.calls[0]![1] as string;
    expect(descArg).toContain('requires');
    expect(descArg).toContain('--email');
    expect(descArg).toContain('--org-id');
  });

  it('leaves description unchanged when no required options', () => {
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

  it('excludes positional args from description enrichment', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'update <slug>',
      'Update a resource',
      (y) =>
        y
          .positional('slug', { type: 'string', demandOption: true })
          .options({ value: { type: 'string', demandOption: true, describe: 'Value' } }),
      async () => {},
    );

    const cmdArg = commandSpy.mock.calls[0]![0] as string;
    const descArg = commandSpy.mock.calls[0]![1] as string;
    expect(cmdArg).toBe('update <slug>');
    expect(descArg).toContain('--value');
    expect(descArg).not.toContain('--slug');
  });

  it('filters out help and version from enriched flags', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'get',
      'Get a resource',
      (y) => y.options({ id: { type: 'string', demandOption: true, describe: 'ID' } }),
      async () => {},
    );

    const descArg = commandSpy.mock.calls[0]![1] as string;
    expect(descArg).not.toContain('--help');
    expect(descArg).not.toContain('--version');
    expect(descArg).toContain('--id');
  });

  it('passes original builder directly (no wrapper)', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');
    const builder = (y: yargs.Argv) => y.options({ count: { type: 'number', demandOption: true, describe: 'Count' } });

    registerSubcommand(parent, 'set', 'Set a value', builder, async () => {});

    // Builder is passed through directly — no wrapper
    expect(commandSpy).toHaveBeenCalledWith('set', 'Set a value (requires --count)', builder, expect.any(Function));
  });

  it('skips enrichment when description already mentions the flag', () => {
    const parent = yargs([]);
    const commandSpy = vi.spyOn(parent, 'command');

    registerSubcommand(
      parent,
      'delete <slug>',
      'Delete an org-scoped role (requires --org)',
      (y) =>
        y
          .positional('slug', { type: 'string', demandOption: true })
          .options({ org: { type: 'string', demandOption: true } }),
      async () => {},
    );

    expect(commandSpy).toHaveBeenCalledWith(
      'delete <slug>',
      'Delete an org-scoped role (requires --org)',
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

  it('falls back to unenriched description when builder throws', () => {
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
