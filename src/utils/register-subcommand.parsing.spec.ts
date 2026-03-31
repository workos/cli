/**
 * Regression tests for registerSubcommand arg parsing.
 *
 * Verifies that commands with demandOption named flags accept standard
 * --flag syntax without yargs demanding phantom positional arguments.
 *
 * Bug: registerSubcommand previously appended `--slug <string>` to the yargs
 * command string, causing yargs to interpret <string> as required positionals.
 */
import { describe, it, expect } from 'vitest';
import yargs from 'yargs';
import type { Options, PositionalOptions } from 'yargs';
import { registerSubcommand } from './register-subcommand.js';

/** Build a yargs parser with a single registerSubcommand call, capturing parse failures. */
function buildParser(usage: string, builder: (y: yargs.Argv) => yargs.Argv) {
  let failMessage: string | undefined;
  let handlerArgs: Record<string, unknown> | undefined;
  const parser = yargs([])
    .exitProcess(false)
    .fail((msg) => {
      failMessage = msg;
    });
  registerSubcommand(parser, usage, 'test', builder, async (argv) => {
    handlerArgs = argv;
  });
  return {
    parseAsync: async (args: string[]) => {
      await parser.parseAsync(args);
      return handlerArgs!;
    },
    getError: () => failMessage,
  };
}

interface OptionsOnlyCase {
  name: string;
  usage: string;
  options: Record<string, Options>;
  args: string[];
  expected: Record<string, unknown>;
}

interface MixedPositionalCase extends OptionsOnlyCase {
  positionals: Record<string, PositionalOptions>;
}

describe('registerSubcommand parsing (regression)', () => {
  const optionsOnlyCases: OptionsOnlyCase[] = [
    {
      name: 'role create: --slug --name',
      usage: 'create',
      options: {
        slug: { type: 'string', demandOption: true },
        name: { type: 'string', demandOption: true },
        description: { type: 'string' },
      },
      args: ['create', '--slug', 'admin', '--name', 'Admin'],
      expected: { slug: 'admin', name: 'Admin' },
    },
    {
      name: 'membership create: --org --user',
      usage: 'create',
      options: {
        org: { type: 'string', demandOption: true },
        user: { type: 'string', demandOption: true },
        role: { type: 'string' },
      },
      args: ['create', '--org', 'org_1', '--user', 'user_1'],
      expected: { org: 'org_1', user: 'user_1' },
    },
    {
      name: 'invitation send: --email',
      usage: 'send',
      options: {
        email: { type: 'string', demandOption: true },
        org: { type: 'string' },
        role: { type: 'string' },
      },
      args: ['send', '--email', 'a@b.com'],
      expected: { email: 'a@b.com' },
    },
    {
      name: 'directory list-groups: --directory',
      usage: 'list-groups',
      options: {
        directory: { type: 'string', demandOption: true },
        limit: { type: 'number' },
      },
      args: ['list-groups', '--directory', 'dir_1'],
      expected: { directory: 'dir_1' },
    },
    {
      name: 'event list: --events',
      usage: 'list',
      options: {
        events: { type: 'string', demandOption: true },
        after: { type: 'string' },
      },
      args: ['list', '--events', 'user.created'],
      expected: { events: 'user.created' },
    },
    {
      name: 'audit-log export: --org --range-start --range-end',
      usage: 'export',
      options: {
        org: { type: 'string', demandOption: true },
        'range-start': { type: 'string', demandOption: true },
        'range-end': { type: 'string', demandOption: true },
      },
      args: ['export', '--org', 'org_1', '--range-start', '2026-01-01', '--range-end', '2026-01-31'],
      expected: { org: 'org_1' },
    },
    {
      name: 'webhook create: --url --events',
      usage: 'create',
      options: {
        url: { type: 'string', demandOption: true },
        events: { type: 'string', demandOption: true },
      },
      args: ['create', '--url', 'https://example.com', '--events', 'user.created'],
      expected: { url: 'https://example.com', events: 'user.created' },
    },
    {
      name: 'portal generate-link: --intent --org',
      usage: 'generate-link',
      options: {
        intent: { type: 'string', demandOption: true },
        org: { type: 'string', demandOption: true },
        'return-url': { type: 'string' },
      },
      args: ['generate-link', '--intent', 'sso', '--org', 'org_1'],
      expected: { intent: 'sso', org: 'org_1' },
    },
    {
      name: 'vault create: --name --value',
      usage: 'create',
      options: {
        name: { type: 'string', demandOption: true },
        value: { type: 'string', demandOption: true },
        org: { type: 'string' },
      },
      args: ['create', '--name', 'secret', '--value', 'abc123'],
      expected: { name: 'secret', value: 'abc123' },
    },
    {
      name: 'api-key list: --org',
      usage: 'list',
      options: {
        org: { type: 'string', demandOption: true },
        limit: { type: 'number' },
      },
      args: ['list', '--org', 'org_1'],
      expected: { org: 'org_1' },
    },
    {
      name: 'api-key create: --org --name',
      usage: 'create',
      options: {
        org: { type: 'string', demandOption: true },
        name: { type: 'string', demandOption: true },
        permissions: { type: 'string' },
      },
      args: ['create', '--org', 'org_1', '--name', 'my-key'],
      expected: { org: 'org_1', name: 'my-key' },
    },
  ];

  it.each(optionsOnlyCases)('$name', async ({ usage, options, args, expected }) => {
    const { parseAsync, getError } = buildParser(usage, (y) => y.options(options));
    const argv = await parseAsync(args);
    expect(getError()).toBeUndefined();
    for (const [key, value] of Object.entries(expected)) {
      expect(argv[key]).toBe(value);
    }
  });

  const mixedPositionalCases: MixedPositionalCase[] = [
    {
      name: 'role set-permissions <slug>: --permissions',
      usage: 'set-permissions <slug>',
      positionals: { slug: { type: 'string', demandOption: true } },
      options: { permissions: { type: 'string', demandOption: true } },
      args: ['set-permissions', 'admin', '--permissions', 'read,write'],
      expected: { slug: 'admin', permissions: 'read,write' },
    },
    {
      name: 'vault update <id>: --value',
      usage: 'update <id>',
      positionals: { id: { type: 'string', demandOption: true } },
      options: { value: { type: 'string', demandOption: true }, 'version-check': { type: 'string' } },
      args: ['update', 'vault_1', '--value', 'new-secret'],
      expected: { id: 'vault_1', value: 'new-secret' },
    },
    {
      name: 'audit-log create-schema <action>: --file',
      usage: 'create-schema <action>',
      positionals: { action: { type: 'string', demandOption: true } },
      options: { file: { type: 'string', demandOption: true } },
      args: ['create-schema', 'user.login', '--file', 'schema.json'],
      expected: { action: 'user.login', file: 'schema.json' },
    },
    {
      name: 'org-domain create <domain>: --org',
      usage: 'create <domain>',
      positionals: { domain: { type: 'string', demandOption: true } },
      options: { org: { type: 'string', demandOption: true } },
      args: ['create', 'example.com', '--org', 'org_1'],
      expected: { domain: 'example.com', org: 'org_1' },
    },
  ];

  it.each(mixedPositionalCases)('$name', async ({ usage, positionals, options, args, expected }) => {
    const { parseAsync, getError } = buildParser(usage, (y) => {
      for (const [key, opts] of Object.entries(positionals)) {
        y.positional(key, opts);
      }
      return y.options(options);
    });
    const argv = await parseAsync(args);
    expect(getError()).toBeUndefined();
    for (const [key, value] of Object.entries(expected)) {
      expect(argv[key]).toBe(value);
    }
  });
});
