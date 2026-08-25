import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/settings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/settings.js')>();
  return { ...actual, getVersion: vi.fn(() => '0.7.3') };
});

const { buildCommandTree, extractHelpJsonCommand } = await import('./help-json.js');

describe('help-json', () => {
  describe('extractHelpJsonCommand()', () => {
    it('extracts a direct command', () => {
      expect(extractHelpJsonCommand(['doctor', '--help', '--json'])).toBe('doctor');
    });

    it('skips --mode values before the command', () => {
      expect(extractHelpJsonCommand(['--mode', 'agent', 'doctor', '--help', '--json'])).toBe('doctor');
    });

    it('skips --mode= values before the command', () => {
      expect(extractHelpJsonCommand(['--mode=agent', 'doctor', '--help', '--json'])).toBe('doctor');
    });

    it('returns undefined when only global flags are present', () => {
      expect(extractHelpJsonCommand(['--mode', 'agent', '--help', '--json'])).toBeUndefined();
    });

    it('resolves command aliases', () => {
      expect(extractHelpJsonCommand(['org', '--help', '--json'])).toBe('organization');
    });
  });

  describe('buildCommandTree() — full tree', () => {
    it('returns root with name "workos"', () => {
      const tree = buildCommandTree();
      expect(tree).toHaveProperty('name', 'workos');
    });

    it('includes version string', () => {
      const tree = buildCommandTree();
      expect(tree).toHaveProperty('version', '0.7.3');
    });

    it('includes top-level description', () => {
      const tree = buildCommandTree();
      expect(tree).toHaveProperty('description');
      expect((tree as { description: string }).description.length).toBeGreaterThan(0);
    });

    it('includes all public commands', () => {
      const tree = buildCommandTree();
      const names = (tree as { commands: { name: string }[] }).commands.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'auth login',
          'auth logout',
          'auth status',
          'skills',
          'doctor',
          'verify-login',
          'profile',
          'organization',
          'user',
          'install',
        ]),
      );
    });

    it('does not include hidden dashboard command', () => {
      const tree = buildCommandTree();
      const names = (tree as { commands: { name: string }[] }).commands.map((c) => c.name);
      expect(names).not.toContain('dashboard');
    });

    it('includes global options with types and defaults', () => {
      const tree = buildCommandTree();
      const opts = (tree as { options: { name: string; type: string; default?: unknown }[] }).options;
      const jsonOpt = opts.find((o) => o.name === 'json');
      expect(jsonOpt).toBeDefined();
      expect(jsonOpt!.type).toBe('boolean');
      expect(jsonOpt!.default).toBe(false);
    });

    it('includes global interaction mode option with choices', () => {
      const tree = buildCommandTree();
      const opts = (tree as { options: { name: string; type: string; choices?: string[] }[] }).options;
      const modeOpt = opts.find((o) => o.name === 'mode');
      expect(modeOpt).toBeDefined();
      expect(modeOpt!.type).toBe('string');
      expect(modeOpt!.choices).toEqual(['human', 'agent', 'ci']);
    });

    it('output is valid JSON-serializable', () => {
      const tree = buildCommandTree();
      const json = JSON.stringify(tree);
      expect(() => JSON.parse(json)).not.toThrow();
    });
  });

  describe('buildCommandTree() — subcommand subtrees', () => {
    it('returns env subtree with subcommands', () => {
      const tree = buildCommandTree('profile');
      expect(tree.name).toBe('profile');
      const subNames = tree.commands!.map((c) => c.name);
      expect(subNames).toEqual(expect.arrayContaining(['add', 'remove', 'switch', 'list', 'claim', 'provision']));
    });

    it('returns organization subtree with CRUD subcommands', () => {
      const tree = buildCommandTree('organization');
      expect(tree.name).toBe('organization');
      const subNames = tree.commands!.map((c) => c.name);
      expect(subNames).toEqual(expect.arrayContaining(['create', 'update', 'get', 'list', 'delete']));
    });

    it('returns user subtree with subcommands', () => {
      const tree = buildCommandTree('user');
      expect(tree.name).toBe('user');
      const subNames = tree.commands!.map((c) => c.name);
      expect(subNames).toEqual(expect.arrayContaining(['get', 'list', 'update', 'delete']));
    });

    it('returns full tree for unknown subcommand', () => {
      const tree = buildCommandTree('nonexistent');
      expect(tree).toHaveProperty('name', 'workos');
      expect(tree).toHaveProperty('version');
    });
  });

  describe('accurate command copy', () => {
    it('migrations description advertises the generic-CSV / Supabase path', () => {
      const tree = buildCommandTree('migrations');
      expect(tree.name).toBe('migrations');
      expect(tree.description).toMatch(/CSV/i);
      expect(tree.description).toMatch(/Supabase/i);
    });

    it('migrations subcommands include the discoverable export entry point', () => {
      const tree = buildCommandTree('migrations');
      const subNames = tree.commands!.map((c) => c.name);
      expect(subNames).toContain('export');
      // process-roles is the name the package actually registers (not process-role-definitions)
      expect(subNames).toContain('process-roles');
      expect(subNames).not.toContain('process-role-definitions');
    });

    it('env remove description states it is local-only', () => {
      const env = buildCommandTree('profile');
      const remove = env.commands!.find((c) => c.name === 'remove');
      expect(remove!.description).toMatch(/local/i);
    });

    it('env claim description states the action is permanent', () => {
      const env = buildCommandTree('profile');
      const claim = env.commands!.find((c) => c.name === 'claim');
      expect(claim!.description).toMatch(/permanent/i);
    });
  });

  describe('positional schemas', () => {
    it('env add has optional positionals', () => {
      const env = buildCommandTree('profile');
      const add = env.commands!.find((c) => c.name === 'add');
      expect(add).toBeDefined();
      expect(add!.positionals).toBeDefined();
      const namePos = add!.positionals!.find((p) => p.name === 'name');
      expect(namePos).toBeDefined();
      expect(namePos!.required).toBe(false);
    });

    it('env remove has required positional', () => {
      const env = buildCommandTree('profile');
      const remove = env.commands!.find((c) => c.name === 'remove');
      expect(remove!.positionals![0].required).toBe(true);
    });

    it('organization create has required name positional', () => {
      const org = buildCommandTree('organization');
      const create = org.commands!.find((c) => c.name === 'create');
      const namePos = create!.positionals!.find((p) => p.name === 'name');
      expect(namePos!.required).toBe(true);
    });

    it('organization delete has required orgId positional', () => {
      const org = buildCommandTree('organization');
      const del = org.commands!.find((c) => c.name === 'delete');
      const orgId = del!.positionals!.find((p) => p.name === 'orgId');
      expect(orgId).toBeDefined();
      expect(orgId!.required).toBe(true);
    });

    it('user update has required userId positional', () => {
      const user = buildCommandTree('user');
      const update = user.commands!.find((c) => c.name === 'update');
      const userId = update!.positionals!.find((p) => p.name === 'userId');
      expect(userId!.required).toBe(true);
    });
  });

  describe('option schemas', () => {
    it('install command has direct option with alias', () => {
      const install = buildCommandTree('install');
      const direct = install.options!.find((o) => o.name === 'direct');
      expect(direct).toBeDefined();
      expect(direct!.alias).toBe('D');
      expect(direct!.type).toBe('boolean');
      expect(direct!.default).toBe(false);
    });

    it('organization list has pagination options', () => {
      const org = buildCommandTree('organization');
      const list = org.commands!.find((c) => c.name === 'list');
      const optNames = list!.options!.map((o) => o.name);
      expect(optNames).toEqual(expect.arrayContaining(['limit', 'before', 'after', 'order']));
    });

    it('user list has email filter and environment override', () => {
      const user = buildCommandTree('user');
      const list = user.commands!.find((c) => c.name === 'list');
      const optNames = list!.options!.map((o) => o.name);
      // --organization was dropped in the dashboard-plane migration (no backing
      // variable on the list operation); --environment-id targets the env.
      expect(optNames).toEqual(expect.arrayContaining(['email', 'environment-id']));
      expect(optNames).not.toContain('organization');
    });
  });
});
