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
  runInvitationList,
  runInvitationGet,
  runInvitationSend,
  runInvitationRevoke,
  runInvitationResend,
  INVITATION_GET_SCAN_LIMIT,
} = await import('./invitation.js');

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

/** The authoritative curated invitation JSON shape (documented contract). */
const INVITATION_SHAPE_KEYS = ['id', 'email', 'state', 'createdAt', 'organization'];

const INVITE_NODE = {
  __typename: 'UserlandUserInvite',
  id: 'invite_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  inviteeEmail: 'jane@example.com',
  state: 'Pending',
  organization: { id: 'org_1', name: 'FooCorp' },
};

describe('invitation command', () => {
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
    it('lists env-wide with the environment as variable AND header (read: no pre-validation)', async () => {
      respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: null } } });
      await runInvitationList({});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUserInvites'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('invite_1');
      expect(out).toContain('jane@example.com');
    });

    it('maps --email to search and pagination flags to catalog variables', async () => {
      respondWith({ userlandUserInvites: { data: [], listMetadata: { before: null, after: null } } });
      await runInvitationList({ email: 'jane@', limit: 5, after: 'cursor_a' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUserInvites'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile', search: 'jane@', limit: 5, after: 'cursor_a' },
        environmentId: 'env_profile',
      });
    });

    it('lists by org via the by-org operation', async () => {
      respondWith({
        organization: {
          userlandUserInvites: {
            data: [{ ...INVITE_NODE, organization: undefined }],
            listMetadata: { before: null, after: null },
          },
        },
      });
      await runInvitationList({ org: 'org_1', limit: 5 });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUserInvitesByOrg'), {
        token: 'tok_123',
        variables: { organizationId: 'org_1', limit: 5 },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('invite_1');
    });

    it('errors not_found when the organization does not exist', async () => {
      respondWith({ organization: null });
      const err = await expectExit(runInvitationList({ org: 'org_missing' }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits the documented curated shape (env-wide)', async () => {
      setOutputMode('json');
      respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
      await runInvitationList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['invitations', 'pagination']);
      expect(Object.keys(out.invitations[0])).toEqual(INVITATION_SHAPE_KEYS);
      expect(out.invitations[0]).toEqual({
        id: 'invite_1',
        email: 'jane@example.com',
        state: 'Pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        organization: { id: 'org_1', name: 'FooCorp' },
      });
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });

    it('--json by-org carries the requested org ID on each row', async () => {
      setOutputMode('json');
      respondWith({
        organization: {
          userlandUserInvites: {
            data: [{ ...INVITE_NODE, organization: undefined }],
            listMetadata: { before: null, after: null },
          },
        },
      });
      await runInvitationList({ org: 'org_1' });
      const out = JSON.parse(consoleOutput[0]);
      expect(out.invitations[0].organization).toEqual({ id: 'org_1', name: null });
    });

    it('handles empty results', async () => {
      respondWith({ userlandUserInvites: { data: [], listMetadata: { before: null, after: null } } });
      await runInvitationList({});
      expect(consoleOutput.some((l) => l.includes('No invitations found'))).toBe(true);
    });
  });

  describe('get (client-side filter, capped)', () => {
    it('scans one capped page and renders the match', async () => {
      respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: null } } });
      await runInvitationGet('invite_1');
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUserInvites'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile', limit: INVITATION_GET_SCAN_LIMIT },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('jane@example.com');
    });

    it('--json emits { invitation } in the curated shape', async () => {
      setOutputMode('json');
      respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: null } } });
      await runInvitationGet('invite_1');
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['invitation']);
      expect(Object.keys(out.invitation)).toEqual(INVITATION_SHAPE_KEYS);
    });

    it('reports a capped miss loudly (not found in the most recent N)', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondWith({ userlandUserInvites: { data: [INVITE_NODE], listMetadata: { before: null, after: 'more' } } });
      const err = await expectExit(runInvitationGet('invite_missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
      expect(consoleErrors.join('\n')).toContain(`${INVITATION_GET_SCAN_LIMIT} most recent`);
    });
  });

  describe('send', () => {
    const created = {
      createUserlandUserInvite: {
        __typename: 'UserlandUserInviteCreated',
        userlandUserInvite: { id: 'invite_new' },
      },
    };

    it('maps flags into the input, defaulting expiry, and pre-validates the environment first', async () => {
      respondWith(created);
      await runInvitationSend({ email: 'jane@example.com', org: 'org_1', role: 'role_1' });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(mockGraphqlRequest.mock.calls.length).toBe(2);
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('createUserlandUserInvite');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: {
            environmentId: 'env_profile',
            inviteeEmail: 'jane@example.com',
            expiresInDays: 7,
            organizationId: 'org_1',
            roleId: 'role_1',
          },
        },
        environmentId: 'env_profile',
      });
    });

    it('honors an explicit --expires-in-days', async () => {
      respondWith(created);
      await runInvitationSend({ email: 'jane@example.com', expiresInDays: 30 });
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: { environmentId: 'env_profile', inviteeEmail: 'jane@example.com', expiresInDays: 30 },
        },
        environmentId: 'env_profile',
      });
    });

    it.each([
      ['CreateUserlandUserInviteUserAlreadyExists', 'already_exists'],
      ['CreateUserlandUserInviteEmailAlreadyInvitedToEnvironment', 'already_invited'],
      ['CreateUserlandUserInviteInvalidInviteeEmail', 'invalid_argument'],
      ['CreateUserlandUserInviteInvalidRole', 'invalid_argument'],
      ['CreateUserlandUserInviteExpiresInDaysTooLong', 'invalid_argument'],
      ['OrganizationNotFound', 'not_found'],
      ['EnvironmentNotFound', 'environment_not_found'],
    ])('maps the %s variant to a clean %s error', async (typename, code) => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondWith({ createUserlandUserInvite: { __typename: typename } });
      const err = await expectExit(runInvitationSend({ email: 'jane@example.com', org: 'org_1' }), 1);
      expect(err.context?.errorCode).toBe(code);
      expect(consoleErrors.join('\n')).not.toMatch(/graphql|userland/i);
    });

    it('--json emits { invitation }', async () => {
      setOutputMode('json');
      respondWith(created);
      await runInvitationSend({ email: 'jane@example.com' });
      expect(JSON.parse(consoleOutput[0])).toEqual({ invitation: { id: 'invite_new' } });
    });
  });

  describe('revoke (destructive)', () => {
    const revoked = {
      revokeUserlandUserInvite: { __typename: 'UserlandUserInviteRevoked', userlandUserInvite: { id: 'invite_1' } },
    };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runInvitationRevoke('invite_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes and sends the revoke input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(revoked);
      await runInvitationRevoke('invite_1', { yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { userlandUserInviteId: 'invite_1' } },
        environmentId: 'env_profile',
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith(revoked);
      await runInvitationRevoke('invite_1', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runInvitationRevoke('invite_1', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('errors not_found on a missing invitation', async () => {
      respondWith({ revokeUserlandUserInvite: { __typename: 'UserlandUserInviteNotFound' } });
      const err = await expectExit(runInvitationRevoke('invite_missing', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors invite_not_pending on a non-pending invitation', async () => {
      respondWith({ revokeUserlandUserInvite: { __typename: 'UserlandUserInviteNotPending' } });
      const err = await expectExit(runInvitationRevoke('invite_1', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('invite_not_pending');
    });

    it('--json emits { revoked }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith(revoked);
      await runInvitationRevoke('invite_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ revoked: 'invite_1' });
    });
  });

  describe('resend', () => {
    const resent = {
      resendUserlandUserInvite: { __typename: 'UserlandUserInviteResent', userlandUserInvite: { id: 'invite_1' } },
    };

    it('sends the resend input with the environment header', async () => {
      respondWith(resent);
      await runInvitationResend('invite_1');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { userlandUserInviteId: 'invite_1' } },
        environmentId: 'env_profile',
      });
    });

    it('errors not_found on a missing invitation', async () => {
      respondWith({ resendUserlandUserInvite: { __typename: 'UserlandUserInviteNotFound' } });
      const err = await expectExit(runInvitationResend('invite_missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors invite_not_pending on a non-pending invitation', async () => {
      respondWith({ resendUserlandUserInvite: { __typename: 'UserlandUserInviteNotPending' } });
      const err = await expectExit(runInvitationResend('invite_1'), 1);
      expect(err.context?.errorCode).toBe('invite_not_pending');
    });

    it('--json emits { resent }', async () => {
      setOutputMode('json');
      respondWith(resent);
      await runInvitationResend('invite_1');
      expect(JSON.parse(consoleOutput[0])).toEqual({ resent: 'invite_1' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runInvitationList({}), 4);
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
      await expectExit(runInvitationList({}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
