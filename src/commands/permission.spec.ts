import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);
const mockGetActiveEnvironment = vi.fn();
const mockGetConfig = vi.fn();

vi.mock('../lib/command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/command-auth.js')>();
  return {
    ...actual,
    requireCommandToken: () => mockRequireCommandToken(),
  };
});

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

vi.mock('../utils/ui.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
    select: vi.fn(),
  },
}));

// The environment-target resolver runs REAL against the mocked wire + config
// store, so mutation tests can assert the pre-validation fetch
// (teamProjectsV2) happens before the operation request.
vi.mock('../lib/config-store.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/config-store.js')>();
  return {
    ...actual,
    getActiveEnvironment: () => mockGetActiveEnvironment(),
    getConfig: () => mockGetConfig(),
    setProfileEnvironmentId: vi.fn(),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');
const { DashboardGraphqlError } = await import('../lib/dashboard-graphql.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runPermissionList, runPermissionGet, runPermissionCreate, runPermissionUpdate, runPermissionDelete } =
  await import('./permission.js');

const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [{ environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] }],
  },
};

const PERMISSION_NODE = {
  id: 'perm_1',
  name: 'Read users',
  slug: 'users:read',
  description: 'Read user records',
  system: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  // Internal fields the curated shape must drop:
  environmentId: 'env_profile',
  isEnabledForApiKeys: true,
};

const SYSTEM_PERMISSION_NODE = {
  ...PERMISSION_NODE,
  id: 'perm_sys',
  slug: 'system:admin',
  name: 'System admin',
  system: true,
};

interface RouteMap {
  list?: unknown;
  createPermission?: unknown;
  updatePermission?: unknown;
  deletePermission?: unknown;
}

/**
 * Route the wire mock by document: the environment resolver's pre-validation
 * fetch (`teamProjectsV2`) gets the team's environments; mutations and the
 * list lookup get their configured payloads.
 */
function respondWith(routes: RouteMap): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    const text = String(doc);
    if (text.includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
    if (text.includes('mutation createPermission')) return routes.createPermission;
    if (text.includes('mutation updatePermission')) return routes.updatePermission;
    if (text.includes('mutation deletePermission')) return routes.deletePermission;
    if (text.includes('permissionsForEnvironment')) return routes.list;
    throw new Error(`Unrouted document in test: ${text.slice(0, 80)}`);
  });
}

async function expectExit(promise: Promise<unknown>, code: number): Promise<CliExit> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected CliExit(${code}) but promise resolved`);
}

/** The authoritative curated permission JSON shape (documented contract). */
const PERMISSION_SHAPE_KEYS = ['id', 'slug', 'name', 'description', 'system', 'createdAt', 'updatedAt'];

const LIST_PAYLOAD = { permissionsForEnvironment: { permissions: [PERMISSION_NODE, SYSTEM_PERMISSION_NODE] } };
const CREATED_PAYLOAD = { createPermission: { __typename: 'PermissionCreated', permission: PERMISSION_NODE } };
const UPDATED_PAYLOAD = {
  updatePermission: { __typename: 'PermissionUpdated', permission: { ...PERMISSION_NODE, name: 'New name' } },
};
const DELETED_PAYLOAD = { deletePermission: { __typename: 'PermissionDeleted', permissionId: 'perm_1' } };

/** Every subcommand's happy-path invocation, for the shared contract matrices. */
const SUBCOMMANDS: Array<{ name: string; routes: RouteMap; run: () => Promise<void> }> = [
  { name: 'list', routes: { list: LIST_PAYLOAD }, run: () => runPermissionList({}) },
  { name: 'get', routes: { list: LIST_PAYLOAD }, run: () => runPermissionGet('users:read') },
  {
    name: 'create',
    routes: { createPermission: CREATED_PAYLOAD },
    run: () => runPermissionCreate({ slug: 'users:read', name: 'Read users', yes: true }),
  },
  {
    name: 'update',
    routes: { list: LIST_PAYLOAD, updatePermission: UPDATED_PAYLOAD },
    run: () => runPermissionUpdate('users:read', { name: 'New name', yes: true }),
  },
  {
    name: 'delete',
    routes: { list: LIST_PAYLOAD, deletePermission: DELETED_PAYLOAD },
    run: () => runPermissionDelete('users:read', { yes: true }),
  },
];

/** The require-flag-gated subcommands (privilege-surface changes). */
const GATED: Array<{ name: string; routes: RouteMap; run: (yes: boolean) => Promise<void> }> = [
  {
    name: 'create',
    routes: { createPermission: CREATED_PAYLOAD },
    run: (yes) => runPermissionCreate({ slug: 'users:read', name: 'Read users', yes }),
  },
  {
    name: 'update',
    routes: { list: LIST_PAYLOAD, updatePermission: UPDATED_PAYLOAD },
    run: (yes) => runPermissionUpdate('users:read', { name: 'New name', yes }),
  },
];

describe('permission command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
    mockRequireCommandToken.mockResolvedValue('tok_123');
    mockConfirm.mockReset();
    mockIsCancel.mockReset();
    mockIsCancel.mockReturnValue(false);
    mockGetActiveEnvironment.mockReturnValue({ apiKey: 'sk_ignored', environmentId: 'env_profile' });
    mockGetConfig.mockReturnValue({
      activeEnvironment: 'default',
      environments: { default: { apiKey: 'sk_ignored', environmentId: 'env_profile' } },
    });
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  describe('list', () => {
    it('lists permissions with the environment as variable and header', async () => {
      respondWith({ list: LIST_PAYLOAD });
      await runPermissionList({});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(2);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('permissionsForEnvironment'), {
        token: 'tok_123',
        variables: { id: 'env_profile' },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('users:read');
    });

    it('--json emits the curated shape', async () => {
      setOutputMode('json');
      respondWith({ list: LIST_PAYLOAD });
      await runPermissionList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|isEnabledForApiKeys/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['permissions']);
      expect(Object.keys(out.permissions[0])).toEqual(PERMISSION_SHAPE_KEYS);
      expect(out.permissions[0]).toMatchObject({ slug: 'users:read', system: false });
    });

    it('handles empty results', async () => {
      respondWith({ list: { permissionsForEnvironment: { permissions: [] } } });
      await runPermissionList({});
      expect(consoleOutput.some((line) => line.includes('No permissions found'))).toBe(true);
    });
  });

  describe('get', () => {
    it('client-filters the list by slug and renders fields', async () => {
      respondWith({ list: LIST_PAYLOAD });
      await runPermissionGet('users:read');
      const out = consoleOutput.join('\n');
      expect(out).toContain('users:read');
      expect(out).toContain('Read users');
    });

    it('--json emits { permission } in the curated shape', async () => {
      setOutputMode('json');
      respondWith({ list: LIST_PAYLOAD });
      await runPermissionGet('users:read');
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out)).toEqual(['permission']);
      expect(Object.keys(out.permission)).toEqual(PERMISSION_SHAPE_KEYS);
    });

    it('errors not_found when the slug does not match', async () => {
      respondWith({ list: LIST_PAYLOAD });
      const err = await expectExit(runPermissionGet('missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('create', () => {
    const created = CREATED_PAYLOAD;

    it('pre-validates the environment, then sends the create input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ createPermission: created });
      await runPermissionCreate({ slug: 'users:read', name: 'Read users', description: 'd', yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { slug: 'users:read', name: 'Read users', description: 'd' } },
        environmentId: 'env_profile',
      });
    });

    it('errors already_exists on a duplicate slug', async () => {
      respondWith({
        createPermission: { createPermission: { __typename: 'PermissionAlreadyExists', slug: 'users:read' } },
      });
      const err = await expectExit(runPermissionCreate({ slug: 'users:read', name: 'Read users', yes: true }), 1);
      expect(err.context?.errorCode).toBe('already_exists');
    });

    it('errors invalid_argument on an invalid slug', async () => {
      respondWith({
        createPermission: { createPermission: { __typename: 'PermissionSlugInvalid', slug: 'bad slug' } },
      });
      const err = await expectExit(runPermissionCreate({ slug: 'bad slug', name: 'Bad', yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
    });

    it('prints a success message in human mode', async () => {
      respondWith({ createPermission: created });
      await runPermissionCreate({ slug: 'users:read', name: 'Read users', yes: true });
      expect(consoleOutput.join('\n')).toContain('Created permission');
    });

    it('--json emits the created { permission }', async () => {
      setOutputMode('json');
      respondWith({ createPermission: created });
      await runPermissionCreate({ slug: 'users:read', name: 'Read users', yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out.permission)).toEqual(PERMISSION_SHAPE_KEYS);
    });
  });

  describe('update (read-merge-write)', () => {
    const updated = UPDATED_PAYLOAD;

    it('requires --name or --description', async () => {
      const err = await expectExit(runPermissionUpdate('users:read', {}), 1);
      expect(err.context?.errorCode).toBe('missing_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('merges the current name/description into the ID-keyed input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ list: LIST_PAYLOAD, updatePermission: updated });
      await runPermissionUpdate('users:read', { name: 'New name', yes: true });
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs[1]).toContain('permissionsForEnvironment');
      expect(docs[2]).toContain('mutation updatePermission');
      // The current description rides along: an omitted description would be
      // cleared server-side.
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { input: { permissionId: 'perm_1', name: 'New name', description: 'Read user records' } },
        environmentId: 'env_profile',
      });
    });

    it('refuses to modify a system permission', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ list: LIST_PAYLOAD });
      const err = await expectExit(runPermissionUpdate('system:admin', { name: 'X', yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs.some((doc) => doc.includes('mutation updatePermission'))).toBe(false);
    });

    it('errors not_found when the slug does not resolve', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ list: { permissionsForEnvironment: { permissions: [] } } });
      const err = await expectExit(runPermissionUpdate('missing', { name: 'X', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors not_found on the PermissionNotFound mutation variant', async () => {
      respondWith({
        list: LIST_PAYLOAD,
        updatePermission: { updatePermission: { __typename: 'PermissionNotFound', permissionId: 'perm_1' } },
      });
      const err = await expectExit(runPermissionUpdate('users:read', { name: 'X', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('prints a success message in human mode', async () => {
      respondWith({ list: LIST_PAYLOAD, updatePermission: updated });
      await runPermissionUpdate('users:read', { name: 'New name', yes: true });
      expect(consoleOutput.join('\n')).toContain('Updated permission');
    });

    it('--json emits the updated { permission }', async () => {
      setOutputMode('json');
      respondWith({ list: LIST_PAYLOAD, updatePermission: updated });
      await runPermissionUpdate('users:read', { name: 'New name', yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.permission).toMatchObject({ slug: 'users:read', name: 'New name' });
    });
  });

  describe('delete (destructive, two-step)', () => {
    const deleted = DELETED_PAYLOAD;

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runPermissionDelete('users:read', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in CI mode without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runPermissionDelete('users:read', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in JSON mode without --yes (keeps stdout machine-readable)', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      setOutputMode('json');
      const err = await expectExit(runPermissionDelete('users:read', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('errors not_found on the PermissionNotFound mutation variant', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({
        list: LIST_PAYLOAD,
        deletePermission: { deletePermission: { __typename: 'PermissionNotFound', permissionId: 'perm_1' } },
      });
      const err = await expectExit(runPermissionDelete('users:read', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('prints a success message in human mode', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith({ list: LIST_PAYLOAD, deletePermission: deleted });
      await runPermissionDelete('users:read', { yes: false });
      expect(consoleOutput.join('\n')).toContain('Deleted permission');
    });

    it('resolves the slug first, then deletes by permission ID', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ list: LIST_PAYLOAD, deletePermission: deleted });
      await runPermissionDelete('users:read', { yes: true });
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs[1]).toContain('permissionsForEnvironment');
      expect(docs[2]).toContain('mutation deletePermission');
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { input: { permissionId: 'perm_1' } },
        environmentId: 'env_profile',
      });
    });

    it('refuses to delete a system permission', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ list: LIST_PAYLOAD });
      const err = await expectExit(runPermissionDelete('system:admin', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs.some((doc) => doc.includes('mutation deletePermission'))).toBe(false);
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith({ list: LIST_PAYLOAD, deletePermission: deleted });
      await runPermissionDelete('users:read', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runPermissionDelete('users:read', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith({ list: LIST_PAYLOAD, deletePermission: deleted });
      await runPermissionDelete('users:read', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'users:read' });
    });
  });

  describe('require-flag matrix (privilege-surface changes)', () => {
    it.each(GATED)('$name refuses in agent mode without --yes', async ({ run }) => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(run(false), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it.each(GATED)('$name refuses in CI mode without --yes', async ({ run }) => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(run(false), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it.each(GATED)('$name refuses in JSON mode without --yes', async ({ run }) => {
      setInteractionMode({ mode: 'human', source: 'default' });
      setOutputMode('json');
      const err = await expectExit(run(false), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it.each(GATED)('$name proceeds without --yes for an interactive human (no prompt)', async ({ run, routes }) => {
      setInteractionMode({ mode: 'human', source: 'default' });
      respondWith(routes);
      await run(false);
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it.each(GATED)('$name proceeds in CI with --yes', async ({ run, routes }) => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(routes);
      await run(true);
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });
  });

  describe('shared failure modes (every subcommand)', () => {
    it.each(SUBCOMMANDS)('$name exits auth-required (code 4) when not logged in', async ({ run }) => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(run(), 4);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it.each(SUBCOMMANDS)('$name sends the environment header on its operation request', async ({ run, routes }) => {
      respondWith(routes);
      await run();
      expect(mockGraphqlRequest).toHaveBeenCalled();
      expect(mockGraphqlRequest.mock.calls.at(-1)![1]).toMatchObject({
        token: 'tok_123',
        environmentId: 'env_profile',
      });
    });

    it.each(SUBCOMMANDS)('$name surfaces a 403 without naming GraphQL', async ({ run }) => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      // The resolver's own pre-validation fetch stays healthy; the OPERATION
      // request is what the capability gate rejects.
      mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
        if (String(doc).includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
        throw new DashboardGraphqlError(
          'The dashboard GraphQL API rejected this session (HTTP 403).',
          'forbidden',
          403,
        );
      });
      await expectExit(run(), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
