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
import { registerSubcommand } from './register-subcommand.js';

/** Build a yargs parser with a single registerSubcommand call, capturing parse failures. */
function buildParser(usage: string, builder: (y: yargs.Argv) => yargs.Argv) {
  let failMessage: string | undefined;
  let handlerArgs: Record<string, unknown> | undefined;
  const parser = yargs([]).exitProcess(false).fail((msg) => {
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

describe('registerSubcommand parsing (regression)', () => {
  // ── Options-only commands ─────────────────────────────────────────────

  it('role create: --slug --name', async () => {
    const { parseAsync, getError } = buildParser('create', (y) =>
      y.options({
        slug: { type: 'string', demandOption: true },
        name: { type: 'string', demandOption: true },
        description: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['create', '--slug', 'admin', '--name', 'Admin']);
    expect(getError()).toBeUndefined();
    expect(argv.slug).toBe('admin');
    expect(argv.name).toBe('Admin');
  });

  it('permission create: --slug --name', async () => {
    const { parseAsync, getError } = buildParser('create', (y) =>
      y.options({
        slug: { type: 'string', demandOption: true },
        name: { type: 'string', demandOption: true },
        description: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['create', '--slug', 'read', '--name', 'Read']);
    expect(getError()).toBeUndefined();
    expect(argv.slug).toBe('read');
    expect(argv.name).toBe('Read');
  });

  it('membership create: --org --user', async () => {
    const { parseAsync, getError } = buildParser('create', (y) =>
      y.options({
        org: { type: 'string', demandOption: true },
        user: { type: 'string', demandOption: true },
        role: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['create', '--org', 'org_1', '--user', 'user_1']);
    expect(getError()).toBeUndefined();
    expect(argv.org).toBe('org_1');
    expect(argv.user).toBe('user_1');
  });

  it('invitation send: --email', async () => {
    const { parseAsync, getError } = buildParser('send', (y) =>
      y.options({
        email: { type: 'string', demandOption: true },
        org: { type: 'string' },
        role: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['send', '--email', 'a@b.com']);
    expect(getError()).toBeUndefined();
    expect(argv.email).toBe('a@b.com');
  });

  it('directory list-groups: --directory', async () => {
    const { parseAsync, getError } = buildParser('list-groups', (y) =>
      y.options({
        directory: { type: 'string', demandOption: true },
        limit: { type: 'number' },
      }),
    );
    const argv = await parseAsync(['list-groups', '--directory', 'dir_1']);
    expect(getError()).toBeUndefined();
    expect(argv.directory).toBe('dir_1');
  });

  it('event list: --events', async () => {
    const { parseAsync, getError } = buildParser('list', (y) =>
      y.options({
        events: { type: 'string', demandOption: true },
        after: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['list', '--events', 'user.created']);
    expect(getError()).toBeUndefined();
    expect(argv.events).toBe('user.created');
  });

  it('audit-log export: --org --range-start --range-end', async () => {
    const { parseAsync, getError } = buildParser('export', (y) =>
      y.options({
        org: { type: 'string', demandOption: true },
        'range-start': { type: 'string', demandOption: true },
        'range-end': { type: 'string', demandOption: true },
      }),
    );
    const argv = await parseAsync(['export', '--org', 'org_1', '--range-start', '2026-01-01', '--range-end', '2026-01-31']);
    expect(getError()).toBeUndefined();
    expect(argv.org).toBe('org_1');
  });

  it('webhook create: --url --events', async () => {
    const { parseAsync, getError } = buildParser('create', (y) =>
      y.options({
        url: { type: 'string', demandOption: true },
        events: { type: 'string', demandOption: true },
      }),
    );
    const argv = await parseAsync(['create', '--url', 'https://example.com', '--events', 'user.created']);
    expect(getError()).toBeUndefined();
    expect(argv.url).toBe('https://example.com');
    expect(argv.events).toBe('user.created');
  });

  it('portal generate-link: --intent --org', async () => {
    const { parseAsync, getError } = buildParser('generate-link', (y) =>
      y.options({
        intent: { type: 'string', demandOption: true },
        org: { type: 'string', demandOption: true },
        'return-url': { type: 'string' },
      }),
    );
    const argv = await parseAsync(['generate-link', '--intent', 'sso', '--org', 'org_1']);
    expect(getError()).toBeUndefined();
    expect(argv.intent).toBe('sso');
    expect(argv.org).toBe('org_1');
  });

  it('vault create: --name --value', async () => {
    const { parseAsync, getError } = buildParser('create', (y) =>
      y.options({
        name: { type: 'string', demandOption: true },
        value: { type: 'string', demandOption: true },
        org: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['create', '--name', 'secret', '--value', 'abc123']);
    expect(getError()).toBeUndefined();
    expect(argv.name).toBe('secret');
    expect(argv.value).toBe('abc123');
  });

  it('api-key list: --org', async () => {
    const { parseAsync, getError } = buildParser('list', (y) =>
      y.options({
        org: { type: 'string', demandOption: true },
        limit: { type: 'number' },
      }),
    );
    const argv = await parseAsync(['list', '--org', 'org_1']);
    expect(getError()).toBeUndefined();
    expect(argv.org).toBe('org_1');
  });

  it('api-key create: --org --name', async () => {
    const { parseAsync, getError } = buildParser('create', (y) =>
      y.options({
        org: { type: 'string', demandOption: true },
        name: { type: 'string', demandOption: true },
        permissions: { type: 'string' },
      }),
    );
    const argv = await parseAsync(['create', '--org', 'org_1', '--name', 'my-key']);
    expect(getError()).toBeUndefined();
    expect(argv.org).toBe('org_1');
    expect(argv.name).toBe('my-key');
  });

  // ── Mixed positional + demandOption commands ──────────────────────────

  it('role set-permissions <slug>: --permissions', async () => {
    const { parseAsync, getError } = buildParser('set-permissions <slug>', (y) =>
      y.positional('slug', { type: 'string', demandOption: true }).option('permissions', {
        type: 'string',
        demandOption: true,
      }),
    );
    const argv = await parseAsync(['set-permissions', 'admin', '--permissions', 'read,write']);
    expect(getError()).toBeUndefined();
    expect(argv.slug).toBe('admin');
    expect(argv.permissions).toBe('read,write');
  });

  it('vault update <id>: --value', async () => {
    const { parseAsync, getError } = buildParser('update <id>', (y) =>
      y.positional('id', { type: 'string', demandOption: true }).options({
        value: { type: 'string', demandOption: true },
        'version-check': { type: 'string' },
      }),
    );
    const argv = await parseAsync(['update', 'vault_1', '--value', 'new-secret']);
    expect(getError()).toBeUndefined();
    expect(argv.id).toBe('vault_1');
    expect(argv.value).toBe('new-secret');
  });

  it('audit-log create-schema <action>: --file', async () => {
    const { parseAsync, getError } = buildParser('create-schema <action>', (y) =>
      y.positional('action', { type: 'string', demandOption: true }).options({
        file: { type: 'string', demandOption: true },
      }),
    );
    const argv = await parseAsync(['create-schema', 'user.login', '--file', 'schema.json']);
    expect(getError()).toBeUndefined();
    expect(argv.action).toBe('user.login');
    expect(argv.file).toBe('schema.json');
  });

  it('org-domain create <domain>: --org', async () => {
    const { parseAsync, getError } = buildParser('create <domain>', (y) =>
      y.positional('domain', { type: 'string', demandOption: true }).options({
        org: { type: 'string', demandOption: true },
      }),
    );
    const argv = await parseAsync(['create', 'example.com', '--org', 'org_1']);
    expect(getError()).toBeUndefined();
    expect(argv.domain).toBe('example.com');
    expect(argv.org).toBe('org_1');
  });
});
