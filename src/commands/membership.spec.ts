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
  runMembershipList,
  runMembershipGet,
  runMembershipCreate,
  runMembershipUpdate,
  runMembershipDelete,
  runMembershipDeactivate,
  runMembershipReactivate,
} = await import('./membership.js');

const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [{ environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] }],
  },
};

/**
 * Route the wire mock by document: the environment resolver's pre-validation
 * fetch (`teamProjectsV2`) gets the team's environments; everything else gets
 * the operation payload.
 */
function respondWith(payload: unknown): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    if (String(doc).includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
    return payload;
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

/** The authoritative curated membership JSON shape (documented contract). */
const MEMBERSHIP_SHAPE_KEYS = [
  'id',
  'userId',
  'organizationId',
  'state',
  'type',
  'role',
  'roles',
  'directoryUserId',
  'createdAt',
  'updatedAt',
];

const MEMBERSHIP_NODE = {
  id: 'om_1',
  type: 'Standard',
  status: 'Active',
  organizationId: 'org_1',
  userlandUserId: 'user_1',
  directoryUserId: null,
  role: 'member',
  roles: ['member'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

describe('membership command', () => {
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
    it('requires --org or --user', async () => {
      const err = await expectExit(runMembershipList({}), 1);
      expect(err.context?.errorCode).toBe('missing_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('rejects --org combined with --user', async () => {
      const err = await expectExit(runMembershipList({ org: 'org_1', user: 'user_1' }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('lists by user with the environment header (no pagination variables)', async () => {
      respondWith({ userlandUserOrganizationMemberships: { organizationMemberships: [MEMBERSHIP_NODE] } });
      await runMembershipList({ user: 'user_1' });
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(2);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUserOrganizationMemberships'), {
        token: 'tok_123',
        variables: { userlandUserId: 'user_1' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('om_1');
      expect(out).toContain('org_1');
    });

    it('rejects pagination/order flags on the by-user path (no backing variables)', async () => {
      const err = await expectExit(runMembershipList({ user: 'user_1', limit: 5 }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('lists by org via the org members operation, flattening identities to memberships', async () => {
      setOutputMode('json');
      respondWith({
        organization: {
          userlandUsers: {
            data: [
              {
                id: 'user_1',
                identities: {
                  data: [
                    {
                      id: 'om_1',
                      status: 'Active',
                      directoryUserId: null,
                      role: { id: 'role_1', name: 'member' },
                      roles: [{ id: 'role_1', name: 'member' }],
                      organization: { id: 'org_1', name: 'FooCorp' },
                      createdAt: '2026-01-01T00:00:00.000Z',
                      updatedAt: '2026-02-01T00:00:00.000Z',
                      // Internal fields the curated shape must drop:
                      ssoProfile: null,
                      customAttributes: { internal: true },
                    },
                  ],
                },
              },
            ],
            listMetadata: { before: null, after: 'cursor_a' },
          },
        },
      });
      await runMembershipList({ org: 'org_1' });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['memberships', 'pagination']);
      expect(Object.keys(out.memberships[0])).toEqual(MEMBERSHIP_SHAPE_KEYS);
      expect(out.memberships[0]).toMatchObject({
        id: 'om_1',
        userId: 'user_1',
        organizationId: 'org_1',
        state: 'active',
        role: 'member',
        roles: ['member'],
      });
      expect(out.memberships[0]).not.toHaveProperty('customAttributes');
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });

    it('maps by-org pagination flags to catalog variables', async () => {
      respondWith({
        organization: { userlandUsers: { data: [], listMetadata: { before: null, after: null } } },
      });
      await runMembershipList({ org: 'org_1', limit: 5, after: 'cursor_a', order: 'desc' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUsersByOrg'), {
        token: 'tok_123',
        variables: { organizationId: 'org_1', limit: 5, after: 'cursor_a', order: 'Desc' },
        environmentId: 'env_profile',
      });
    });

    it('errors not_found when the organization does not exist', async () => {
      respondWith({ organization: null });
      const err = await expectExit(runMembershipList({ org: 'org_missing' }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits the by-user curated shape with null pagination', async () => {
      setOutputMode('json');
      respondWith({ userlandUserOrganizationMemberships: { organizationMemberships: [MEMBERSHIP_NODE] } });
      await runMembershipList({ user: 'user_1' });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['memberships', 'pagination']);
      expect(Object.keys(out.memberships[0])).toEqual(MEMBERSHIP_SHAPE_KEYS);
      expect(out.memberships[0].userId).toBe('user_1');
      expect(out.pagination).toEqual({ before: null, after: null });
    });

    it('handles empty results', async () => {
      respondWith({ userlandUserOrganizationMemberships: { organizationMemberships: [] } });
      await runMembershipList({ user: 'user_1' });
      expect(consoleOutput.some((l) => l.includes('No memberships found'))).toBe(true);
    });
  });

  describe('get', () => {
    it('fetches by ID with the environment header and renders fields', async () => {
      respondWith({ userlandUserOrganizationMembership: MEMBERSHIP_NODE });
      await runMembershipGet('om_1');
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUserOrganizationMembership'), {
        token: 'tok_123',
        variables: { id: 'om_1' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('om_1');
      expect(out).toContain('user_1');
    });

    it('--json emits { membership } in the curated shape', async () => {
      setOutputMode('json');
      respondWith({ userlandUserOrganizationMembership: MEMBERSHIP_NODE });
      await runMembershipGet('om_1');
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['membership']);
      expect(Object.keys(out.membership)).toEqual(MEMBERSHIP_SHAPE_KEYS);
      expect(out.membership).toMatchObject({
        id: 'om_1',
        userId: 'user_1',
        organizationId: 'org_1',
        state: 'active',
        type: 'standard',
      });
    });

    it('errors not_found when the membership does not exist', async () => {
      respondWith({ userlandUserOrganizationMembership: null });
      const err = await expectExit(runMembershipGet('om_missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('create', () => {
    const added = { addUserlandUserToOrganization: { __typename: 'UserlandUserAddedToOrganization' } };

    it('maps flags into the input and pre-validates the environment first', async () => {
      respondWith(added);
      await runMembershipCreate({ org: 'org_1', user: 'user_1', role: 'role_1' });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(mockGraphqlRequest.mock.calls.length).toBe(2);
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('addUserlandUserToOrg');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { organizationId: 'org_1', userlandUserId: 'user_1', roleId: 'role_1' } },
        environmentId: 'env_profile',
      });
    });

    it('omits roleId when --role is not passed', async () => {
      respondWith(added);
      await runMembershipCreate({ org: 'org_1', user: 'user_1' });
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { organizationId: 'org_1', userlandUserId: 'user_1' } },
        environmentId: 'env_profile',
      });
    });

    it('errors not_found when the organization is missing', async () => {
      respondWith({ addUserlandUserToOrganization: { __typename: 'OrganizationNotFound', organizationId: 'org_1' } });
      const err = await expectExit(runMembershipCreate({ org: 'org_1', user: 'user_1' }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors already_invited without echoing internal naming', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondWith({
        addUserlandUserToOrganization: {
          __typename: 'UserlandUserAlreadyInvited',
          userlandUserId: 'user_1',
          organizationId: 'org_1',
        },
      });
      const err = await expectExit(runMembershipCreate({ org: 'org_1', user: 'user_1' }), 1);
      expect(err.context?.errorCode).toBe('already_invited');
      expect(consoleErrors.join('\n')).not.toMatch(/graphql|userland/i);
    });

    it('--json emits { added }', async () => {
      setOutputMode('json');
      respondWith(added);
      await runMembershipCreate({ org: 'org_1', user: 'user_1' });
      expect(JSON.parse(consoleOutput[0])).toEqual({ added: { organizationId: 'org_1', userId: 'user_1' } });
    });
  });

  describe('update (require-flag)', () => {
    const updated = {
      updateRoleOnOrganizationMembership: {
        __typename: 'RoleOnOrganizationMembershipUpdated',
        organizationMembership: { ...MEMBERSHIP_NODE, role: 'admin', roles: ['admin'] },
      },
    };

    it('requires --role', async () => {
      const err = await expectExit(runMembershipUpdate('om_1', {}), 1);
      expect(err.context?.errorCode).toBe('missing_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in agent mode without --yes (privilege change)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runMembershipUpdate('om_1', { role: 'role_admin' }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes and sends the update input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(updated);
      await runMembershipUpdate('om_1', { role: 'role_admin', yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { organizationMembershipId: 'om_1', roleId: 'role_admin' } },
        environmentId: 'env_profile',
      });
    });

    it('proceeds without --yes for an interactive human (no prompt)', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      respondWith(updated);
      await runMembershipUpdate('om_1', { role: 'role_admin' });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('errors not_found when the role is missing', async () => {
      respondWith({ updateRoleOnOrganizationMembership: { __typename: 'RoleNotFound', roleId: 'role_missing' } });
      const err = await expectExit(runMembershipUpdate('om_1', { role: 'role_missing', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors not_found when the membership is missing', async () => {
      respondWith({
        updateRoleOnOrganizationMembership: {
          __typename: 'UserlandUserOrganizationMembershipNotFound',
          message: 'internal',
        },
      });
      const err = await expectExit(runMembershipUpdate('om_1', { role: 'role_admin', yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits the updated { membership }', async () => {
      setOutputMode('json');
      respondWith(updated);
      await runMembershipUpdate('om_1', { role: 'role_admin', yes: true });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.membership).toMatchObject({ id: 'om_1', role: 'admin' });
    });
  });

  describe('delete (destructive, two-step)', () => {
    function respondForDelete(removePayload: unknown, lookupPayload?: unknown): void {
      mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
        const text = String(doc);
        if (text.includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
        if (text.includes('removeMemberFromOrganization')) return removePayload;
        return lookupPayload ?? { userlandUserOrganizationMembership: MEMBERSHIP_NODE };
      });
    }

    const removed = { removeUserlandUserFromOrganization: { __typename: 'UserlandUserRemovedFromOrganization' } };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runMembershipDelete('om_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('resolves the membership first, then removes by org+user', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondForDelete(removed);
      await runMembershipDelete('om_1', { yes: true });
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs[1]).toContain('userlandUserOrganizationMembership');
      expect(docs[2]).toContain('removeMemberFromOrganization');
      expect(mockGraphqlRequest.mock.calls[2][1]).toEqual({
        token: 'tok_123',
        variables: { input: { organizationId: 'org_1', userlandUserId: 'user_1' } },
        environmentId: 'env_profile',
      });
    });

    it('errors not_found when the membership lookup misses (no remove attempted)', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondForDelete(removed, { userlandUserOrganizationMembership: null });
      const err = await expectExit(runMembershipDelete('om_missing', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs.some((doc) => doc.includes('removeMemberFromOrganization'))).toBe(false);
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondForDelete(removed);
      await runMembershipDelete('om_1', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runMembershipDelete('om_1', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondForDelete(removed);
      await runMembershipDelete('om_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'om_1' });
    });
  });

  describe('deactivate (require-flag) / reactivate', () => {
    it('deactivate refuses in agent mode without --yes', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runMembershipDeactivate('om_1', {}), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('deactivate proceeds with --yes and sends the membership ID input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({
        deactivateUserlandUserOrganizationMembership: {
          __typename: 'UserlandUserOrganizationMembershipDeactivated',
        },
      });
      await runMembershipDeactivate('om_1', { yes: true });
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { userlandUserOrganizationMembershipId: 'om_1' } },
        environmentId: 'env_profile',
      });
    });

    it('deactivate --json emits { deactivated }', async () => {
      setOutputMode('json');
      respondWith({
        deactivateUserlandUserOrganizationMembership: {
          __typename: 'UserlandUserOrganizationMembershipDeactivated',
        },
      });
      await runMembershipDeactivate('om_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deactivated: 'om_1' });
    });

    it('reactivate needs no flag and sends the membership ID input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith({
        reactivateUserlandUserOrganizationMembership: {
          __typename: 'UserlandUserOrganizationMembershipReactivated',
        },
      });
      await runMembershipReactivate('om_1');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { userlandUserOrganizationMembershipId: 'om_1' } },
        environmentId: 'env_profile',
      });
    });

    it('reactivate errors not_found on a missing membership', async () => {
      respondWith({
        reactivateUserlandUserOrganizationMembership: {
          __typename: 'UserlandUserOrganizationMembershipNotFound',
          message: 'internal',
        },
      });
      const err = await expectExit(runMembershipReactivate('om_missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('reactivate --json emits { reactivated }', async () => {
      setOutputMode('json');
      respondWith({
        reactivateUserlandUserOrganizationMembership: {
          __typename: 'UserlandUserOrganizationMembershipReactivated',
        },
      });
      await runMembershipReactivate('om_1');
      expect(JSON.parse(consoleOutput[0])).toEqual({ reactivated: 'om_1' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runMembershipList({ user: 'user_1' }), 4);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('surfaces the gated-capability case on a 403 without naming GraphQL', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      mockGraphqlRequest.mockRejectedValue(
        new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', 'forbidden', 403),
      );
      await expectExit(runMembershipList({ user: 'user_1' }), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
