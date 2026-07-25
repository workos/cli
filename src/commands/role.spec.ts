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
const {
  runRoleList,
  runRoleGet,
  runRoleCreate,
  runRoleUpdate,
  runRoleDelete,
  runRoleSetPermissions,
  runRoleAddPermission,
  runRoleRemovePermission,
} = await import('./role.js');

const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [{ environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] }],
  },
};

// List-operation shape: the Role fragment PLUS the list documents' explicit
// `permissions { id slug }` selection.
const ENV_ROLE = {
  id: 'role_env',
  name: 'Admin',
  slug: 'admin',
  description: 'Administrator',
  state: 'Active',
  type: 'Environment',
  permissions: [{ id: 'perm_1', slug: 'users:read' }],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  // Internal fields the curated shape must drop:
  resourceTypeId: 'rt_1',
  defaultForOrganizationsCount: 0,
};

const ORG_ROLE = {
  ...ENV_ROLE,
  id: 'role_org',
  name: 'Org Admin',
  slug: 'org-admin',
  description: 'Organization admin',
  type: 'Organization',
  permissions: [{ id: 'perm_2', slug: 'billing:manage' }],
};

// Mutation-response shape: the bare Role fragment — it selects NO permissions,
// which is exactly why the handlers overlay the known slugs.
function mutationRole(overrides: Record<string, unknown> = {}) {
  const { permissions: _permissions, ...fragment } = ENV_ROLE;
  return { ...fragment, ...overrides };
}

const ENV_LIST = { rolesForEnvironment: { roles: [ENV_ROLE] } };
const ORG_LIST = { rolesForOrganization: { roles: [ORG_ROLE, ENV_ROLE] } };
const CREATED = { createRole: { __typename: 'RoleCreated', role: mutationRole() } };
const UPDATED = { updateRole: { __typename: 'RoleUpdated', role: mutationRole({ description: 'New desc' }) } };
const DELETED = { deleteRole: { __typename: 'RoleDeleted', roleConfig: { id: 'rc_1' } } };

interface RouteMap {
  envList?: unknown;
  orgList?: unknown;
  createRole?: unknown;
  updateRole?: unknown;
  deleteRole?: unknown;
}

/**
 * Route the wire mock by document: the environment resolver's pre-validation
 * fetch (`teamProjectsV2`) gets the team's environments; mutations and list
 * lookups get their configured payloads.
 */
function respondWith(routes: RouteMap): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    const text = String(doc);
    if (text.includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
    if (text.includes('mutation createRole')) return routes.createRole;
    if (text.includes('mutation updateRole')) return routes.updateRole;
    if (text.includes('mutation deleteRole')) return routes.deleteRole;
    if (text.includes('rolesForOrganization')) return routes.orgList;
    if (text.includes('rolesForEnvironment')) return routes.envList;
    throw new Error(`Unrouted document in test: ${text.slice(0, 80)}`);
  });
}

function requestedDocs(): string[] {
  return mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
}

function lastCallOptions(): Record<string, unknown> {
  return mockGraphqlRequest.mock.calls.at(-1)![1] as Record<string, unknown>;
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

/** The authoritative curated role JSON shape (documented contract). */
const ROLE_SHAPE_KEYS = ['id', 'slug', 'name', 'description', 'type', 'permissions', 'createdAt', 'updatedAt'];

/** Every subcommand's happy-path invocation, for the shared contract matrices. */
const SUBCOMMANDS: Array<{ name: string; routes: RouteMap; run: () => Promise<void> }> = [
  { name: 'list', routes: { envList: ENV_LIST }, run: () => runRoleList({}) },
  { name: 'get', routes: { envList: ENV_LIST }, run: () => runRoleGet('admin') },
  {
    name: 'create',
    routes: { createRole: CREATED },
    run: () => runRoleCreate({ slug: 'admin', name: 'Admin', yes: true }),
  },
  {
    name: 'update',
    routes: { envList: ENV_LIST, updateRole: UPDATED },
    run: () => runRoleUpdate('admin', { description: 'New desc', yes: true }),
  },
  {
    name: 'delete',
    routes: { orgList: ORG_LIST, deleteRole: DELETED },
    run: () => runRoleDelete('org-admin', { org: 'org_1', yes: true }),
  },
  {
    name: 'set-permissions',
    routes: { envList: ENV_LIST, updateRole: UPDATED },
    run: () => runRoleSetPermissions('admin', ['a:read'], { yes: true }),
  },
  {
    name: 'add-permission',
    routes: { envList: ENV_LIST, updateRole: UPDATED },
    run: () => runRoleAddPermission('admin', 'b:write', { yes: true }),
  },
  {
    name: 'remove-permission',
    routes: { orgList: ORG_LIST, updateRole: UPDATED },
    run: () => runRoleRemovePermission('org-admin', 'billing:manage', { org: 'org_1', yes: true }),
  },
];

/** The require-flag-gated subcommands (privilege changes). */
const GATED: Array<{ name: string; routes: RouteMap; run: (yes: boolean) => Promise<void> }> = [
  {
    name: 'create',
    routes: { createRole: CREATED },
    run: (yes) => runRoleCreate({ slug: 'admin', name: 'Admin', yes }),
  },
  {
    name: 'update',
    routes: { envList: ENV_LIST, updateRole: UPDATED },
    run: (yes) => runRoleUpdate('admin', { description: 'New desc', yes }),
  },
  {
    name: 'set-permissions',
    routes: { envList: ENV_LIST, updateRole: UPDATED },
    run: (yes) => runRoleSetPermissions('admin', ['a:read'], { yes }),
  },
  {
    name: 'add-permission',
    routes: { envList: ENV_LIST, updateRole: UPDATED },
    run: (yes) => runRoleAddPermission('admin', 'b:write', { yes }),
  },
  {
    name: 'remove-permission',
    routes: { orgList: ORG_LIST, updateRole: UPDATED },
    run: (yes) => runRoleRemovePermission('org-admin', 'billing:manage', { org: 'org_1', yes }),
  },
];

describe('role command', () => {
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
    it('lists environment roles with the environment as variable and header', async () => {
      respondWith({ envList: ENV_LIST });
      await runRoleList({});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('rolesForEnvironment'), {
        token: 'tok_123',
        variables: { id: 'env_profile' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('admin');
      expect(out).toContain('Environment');
    });

    it('lists organization roles via the org list operation with --org', async () => {
      respondWith({ orgList: ORG_LIST });
      await runRoleList({ org: 'org_1' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('rolesForOrganization'), {
        token: 'tok_123',
        variables: { organizationId: 'org_1', environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('org-admin');
    });

    it('--json emits the curated shape with permission slugs', async () => {
      setOutputMode('json');
      respondWith({ envList: ENV_LIST });
      await runRoleList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|resource_type|resourceTypeId/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['roles']);
      expect(Object.keys(out.roles[0])).toEqual(ROLE_SHAPE_KEYS);
      expect(out.roles[0]).toMatchObject({
        slug: 'admin',
        type: 'Environment',
        permissions: ['users:read'],
      });
    });

    it('handles empty results', async () => {
      respondWith({ envList: { rolesForEnvironment: { roles: [] } } });
      await runRoleList({});
      expect(consoleOutput.some((line) => line.includes('No roles found'))).toBe(true);
    });
  });

  describe('get', () => {
    it('client-filters the list by slug and renders fields', async () => {
      respondWith({ envList: ENV_LIST });
      await runRoleGet('admin');
      const out = consoleOutput.join('\n');
      expect(out).toContain('admin');
      expect(out).toContain('users:read');
    });

    it('resolves through the org list with --org', async () => {
      respondWith({ orgList: ORG_LIST });
      await runRoleGet('org-admin', { org: 'org_1' });
      expect(requestedDocs()[0]).toContain('rolesForOrganization');
      expect(consoleOutput.join('\n')).toContain('org-admin');
    });

    it('--json emits { role } in the curated shape', async () => {
      setOutputMode('json');
      respondWith({ envList: ENV_LIST });
      await runRoleGet('admin');
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out)).toEqual(['role']);
      expect(Object.keys(out.role)).toEqual(ROLE_SHAPE_KEYS);
    });

    it('errors not_found when the slug does not match', async () => {
      respondWith({ envList: ENV_LIST });
      const err = await expectExit(runRoleGet('missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('create', () => {
    it('pre-validates the environment, then sends the create input (org scope via --org)', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ createRole: CREATED });
      await runRoleCreate({ slug: 'org-admin', name: 'Org Admin', description: 'd', org: 'org_1', yes: true });
      expect(requestedDocs()[0]).toContain('teamProjectsV2');
      expect(requestedDocs()[1]).toContain('mutation createRole');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: { slug: 'org-admin', name: 'Org Admin', description: 'd', organizationId: 'org_1' },
        },
        environmentId: 'env_profile',
      });
    });

    it('omits description and organizationId when not passed', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ createRole: CREATED });
      await runRoleCreate({ slug: 'admin', name: 'Admin', yes: true });
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { slug: 'admin', name: 'Admin' } },
        environmentId: 'env_profile',
      });
    });

    it('prints a success message in human mode', async () => {
      respondWith({ createRole: CREATED });
      await runRoleCreate({ slug: 'admin', name: 'Admin', yes: true });
      expect(consoleOutput.join('\n')).toContain('Created role');
    });

    it('errors already_exists on a duplicate slug', async () => {
      respondWith({ createRole: { createRole: { __typename: 'RoleAlreadyExists', slug: 'admin' } } });
      const err = await expectExit(runRoleCreate({ slug: 'admin', name: 'Admin', yes: true }), 1);
      expect(err.context?.errorCode).toBe('already_exists');
    });

    it('errors not_found when the environment is rejected', async () => {
      respondWith({ createRole: { createRole: { __typename: 'EnvironmentNotFound', environmentId: 'env_profile' } } });
      const err = await expectExit(runRoleCreate({ slug: 'admin', name: 'Admin', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits the created { role }', async () => {
      setOutputMode('json');
      respondWith({ createRole: CREATED });
      await runRoleCreate({ slug: 'admin', name: 'Admin', yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out.role)).toEqual(ROLE_SHAPE_KEYS);
      // The create grammar cannot seed permissions; the fresh role has none.
      expect(out.role.permissions).toEqual([]);
    });
  });

  describe('update (read-merge-write)', () => {
    it('requires --name or --description', async () => {
      const err = await expectExit(runRoleUpdate('admin', {}), 1);
      expect(err.context?.errorCode).toBe('missing_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('merges the current name/description into the ID-keyed input (update requires name)', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleUpdate('admin', { description: 'New desc', yes: true });
      const docs = requestedDocs();
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs[1]).toContain('rolesForEnvironment');
      expect(docs[2]).toContain('mutation updateRole');
      // The current name rides along: the backing input REQUIRES name, and an
      // omitted description would be cleared server-side.
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { input: { roleId: 'role_env', name: 'Admin', description: 'New desc' } },
        environmentId: 'env_profile',
      });
    });

    it('prints a success message in human mode', async () => {
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleUpdate('admin', { name: 'Renamed', yes: true });
      expect(consoleOutput.join('\n')).toContain('Updated role');
    });

    it('refuses to update an inherited environment role through --org', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ orgList: { rolesForOrganization: { roles: [ENV_ROLE] } } });
      const err = await expectExit(runRoleUpdate('admin', { name: 'X', org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(requestedDocs().some((doc) => doc.includes('mutation updateRole'))).toBe(false);
    });

    it('errors not_found when the slug does not resolve', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ envList: { rolesForEnvironment: { roles: [] } } });
      const err = await expectExit(runRoleUpdate('missing', { name: 'X', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors not_found on the RoleNotFound mutation variant', async () => {
      respondWith({
        envList: ENV_LIST,
        updateRole: { updateRole: { __typename: 'RoleNotFound', roleId: 'role_env' } },
      });
      const err = await expectExit(runRoleUpdate('admin', { name: 'X', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits the updated { role } with permissions overlaid (mutation response has none)', async () => {
      setOutputMode('json');
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleUpdate('admin', { description: 'New desc', yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out.role)).toEqual(ROLE_SHAPE_KEYS);
      expect(out.role).toMatchObject({ slug: 'admin', description: 'New desc' });
      // The update mutation's response selects no permissions — the shape
      // carries the pre-mutation list, which this input cannot change.
      expect(out.role.permissions).toEqual(['users:read']);
    });
  });

  describe('delete (destructive, org-scoped)', () => {
    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runRoleDelete('org-admin', { org: 'org_1', yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in CI mode without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runRoleDelete('org-admin', { org: 'org_1', yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in JSON mode without --yes (keeps stdout machine-readable)', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      setOutputMode('json');
      const err = await expectExit(runRoleDelete('org-admin', { org: 'org_1', yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('resolves the slug in the org scope, then deletes by role ID', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ orgList: ORG_LIST, deleteRole: DELETED });
      await runRoleDelete('org-admin', { org: 'org_1', yes: true });
      const docs = requestedDocs();
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs[1]).toContain('rolesForOrganization');
      expect(docs[2]).toContain('mutation deleteRole');
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { input: { roleId: 'role_org' } },
        environmentId: 'env_profile',
      });
    });

    it('prints a success message in human mode', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith({ orgList: ORG_LIST, deleteRole: DELETED });
      await runRoleDelete('org-admin', { org: 'org_1', yes: false });
      expect(consoleOutput.join('\n')).toContain('Deleted role');
    });

    it('refuses to delete an inherited environment role through --org', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ orgList: { rolesForOrganization: { roles: [ENV_ROLE] } } });
      const err = await expectExit(runRoleDelete('admin', { org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(requestedDocs().some((doc) => doc.includes('mutation deleteRole'))).toBe(false);
    });

    it('errors not_found when the slug does not resolve in the organization', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ orgList: { rolesForOrganization: { roles: [] } } });
      const err = await expectExit(runRoleDelete('missing', { org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors not_found on the RoleNotFound mutation variant', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({
        orgList: ORG_LIST,
        deleteRole: { deleteRole: { __typename: 'RoleNotFound', roleId: 'role_org' } },
      });
      const err = await expectExit(runRoleDelete('org-admin', { org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith({ orgList: ORG_LIST, deleteRole: DELETED });
      await runRoleDelete('org-admin', { org: 'org_1', yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runRoleDelete('org-admin', { org: 'org_1', yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith({ orgList: ORG_LIST, deleteRole: DELETED });
      await runRoleDelete('org-admin', { org: 'org_1', yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'org-admin' });
    });
  });

  describe('set-permissions (rides the update op)', () => {
    it('replaces the full slug list, carrying name/description', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleSetPermissions('admin', ['a:read', 'b:write'], { yes: true });
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: {
            roleId: 'role_env',
            name: 'Admin',
            description: 'Administrator',
            permissions: ['a:read', 'b:write'],
          },
        },
        environmentId: 'env_profile',
      });
    });

    it('prints a success message in human mode', async () => {
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleSetPermissions('admin', ['a:read', 'b:write'], { yes: true });
      expect(consoleOutput.join('\n')).toContain('Set 2 permissions on role');
    });

    it('errors not_found on the RoleNotFound mutation variant', async () => {
      respondWith({
        envList: ENV_LIST,
        updateRole: { updateRole: { __typename: 'RoleNotFound', roleId: 'role_env' } },
      });
      const err = await expectExit(runRoleSetPermissions('admin', ['a:read'], { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('refuses to touch an inherited environment role through --org', async () => {
      respondWith({ orgList: { rolesForOrganization: { roles: [ENV_ROLE] } } });
      const err = await expectExit(runRoleSetPermissions('admin', ['a:read'], { org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
    });

    it('--json emits { role } with the new permission list overlaid', async () => {
      setOutputMode('json');
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleSetPermissions('admin', ['a:read', 'b:write'], { yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out.role)).toEqual(ROLE_SHAPE_KEYS);
      expect(out.role.permissions).toEqual(['a:read', 'b:write']);
    });
  });

  describe('add-permission (rides the update op)', () => {
    it('merges into the current list (deduped)', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleAddPermission('admin', 'billing:manage', { yes: true });
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: {
            roleId: 'role_env',
            name: 'Admin',
            description: 'Administrator',
            permissions: ['users:read', 'billing:manage'],
          },
        },
        environmentId: 'env_profile',
      });
    });

    it('is idempotent for an already-assigned slug', async () => {
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleAddPermission('admin', 'users:read', { yes: true });
      expect(
        (mockGraphqlRequest.mock.calls[2][1] as { variables: { input: { permissions: string[] } } }).variables.input
          .permissions,
      ).toEqual(['users:read']);
    });

    it('prints a success message in human mode', async () => {
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleAddPermission('admin', 'billing:manage', { yes: true });
      expect(consoleOutput.join('\n')).toContain('Added permission');
    });

    it('errors not_found when the role slug does not resolve', async () => {
      respondWith({ envList: { rolesForEnvironment: { roles: [] } } });
      const err = await expectExit(runRoleAddPermission('missing', 'a:read', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors not_found on the RoleNotFound mutation variant', async () => {
      respondWith({
        envList: ENV_LIST,
        updateRole: { updateRole: { __typename: 'RoleNotFound', roleId: 'role_env' } },
      });
      const err = await expectExit(runRoleAddPermission('admin', 'billing:manage', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits { role } with the merged permission list overlaid', async () => {
      setOutputMode('json');
      respondWith({ envList: ENV_LIST, updateRole: UPDATED });
      await runRoleAddPermission('admin', 'billing:manage', { yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.role.permissions).toEqual(['users:read', 'billing:manage']);
    });
  });

  describe('remove-permission (rides the update op, org scope required)', () => {
    it('filters the current list', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ orgList: ORG_LIST, updateRole: UPDATED });
      await runRoleRemovePermission('org-admin', 'billing:manage', { org: 'org_1', yes: true });
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: { roleId: 'role_org', name: 'Org Admin', description: 'Organization admin', permissions: [] },
        },
        environmentId: 'env_profile',
      });
    });

    it('prints a success message in human mode', async () => {
      respondWith({ orgList: ORG_LIST, updateRole: UPDATED });
      await runRoleRemovePermission('org-admin', 'billing:manage', { org: 'org_1', yes: true });
      expect(consoleOutput.join('\n')).toContain('Removed permission');
    });

    it('errors not_found when the role lacks the permission', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({ orgList: ORG_LIST });
      const err = await expectExit(runRoleRemovePermission('org-admin', 'nope:none', { org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
      expect(requestedDocs().some((doc) => doc.includes('mutation updateRole'))).toBe(false);
    });

    it('errors not_found on the RoleNotFound mutation variant', async () => {
      respondWith({
        orgList: ORG_LIST,
        updateRole: { updateRole: { __typename: 'RoleNotFound', roleId: 'role_org' } },
      });
      const err = await expectExit(
        runRoleRemovePermission('org-admin', 'billing:manage', { org: 'org_1', yes: true }),
        1,
      );
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('refuses to touch an inherited environment role', async () => {
      respondWith({ orgList: { rolesForOrganization: { roles: [ENV_ROLE] } } });
      const err = await expectExit(runRoleRemovePermission('admin', 'users:read', { org: 'org_1', yes: true }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
    });

    it('--json emits { role } with the filtered permission list overlaid', async () => {
      setOutputMode('json');
      respondWith({ orgList: ORG_LIST, updateRole: UPDATED });
      await runRoleRemovePermission('org-admin', 'billing:manage', { org: 'org_1', yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.role.permissions).toEqual([]);
    });
  });

  describe('require-flag matrix (privilege changes)', () => {
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
      expect(lastCallOptions()).toMatchObject({ token: 'tok_123', environmentId: 'env_profile' });
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
