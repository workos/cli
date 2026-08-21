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
const { runUserGet, runUserList, runUserUpdate, runUserDelete } = await import('./user.js');

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

/** The authoritative curated user JSON shape (documented contract). */
const USER_SHAPE_KEYS = [
  'id',
  'email',
  'firstName',
  'lastName',
  'createdAt',
  'emailVerifiedAt',
  'lastSignedInAt',
  'sessionCount',
  'hasPassword',
  'locale',
  'externalId',
  'profilePictureUrl',
  'metadata',
  'identities',
];

const USER_NODE = {
  id: 'user_1',
  email: 'jane@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  createdAt: '2026-01-01T00:00:00.000Z',
  emailVerifiedAt: '2026-01-02T00:00:00.000Z',
  lastSignedInAt: '2026-02-01T00:00:00.000Z',
  sessionCount: 4,
  hasPassword: true,
  locale: 'en-US',
  externalId: null,
  profilePictureUrl: null,
  metadata: [{ key: 'team', value: 'blue' }],
  identities: {
    data: [
      {
        id: 'ident_1',
        status: 'Active',
        organization: { id: 'org_1', name: 'FooCorp' },
        roles: [{ id: 'role_1', name: 'member' }],
        // Internal fields the curated shape must drop:
        customAttributes: { internal: true },
        ssoProfile: null,
      },
    ],
  },
  // Internal fields the curated shape must drop:
  googleOauthProfile: { id: 'oauth_1' },
  directoryUser: null,
};

describe('user command', () => {
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

  describe('get', () => {
    it('fetches by ID with the environment header and renders fields', async () => {
      respondWith({ userlandUser: USER_NODE });
      await runUserGet('user_1');
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUser'), {
        token: 'tok_123',
        variables: { id: 'user_1' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('jane@example.com');
      expect(out).toContain('Jane Doe');
    });

    it('--json emits { user } in the curated shape (auth factors, no internal fields)', async () => {
      setOutputMode('json');
      respondWith({
        userlandUser: {
          ...USER_NODE,
          authenticationFactors: [{ id: 'fac_1', lastVerifiedAt: null, factorType: { __typename: 'Totp' } }],
        },
      });
      await runUserGet('user_1');
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['user']);
      expect(Object.keys(out.user)).toEqual([...USER_SHAPE_KEYS, 'authenticationFactors']);
      expect(out.user).not.toHaveProperty('googleOauthProfile');
      expect(out.user.metadata).toEqual({ team: 'blue' });
      // Backend emits `status: 'Active'`; the contract renames to `state` and lowercases.
      expect(out.user.identities[0]).toEqual({
        id: 'ident_1',
        state: 'active',
        organization: { id: 'org_1', name: 'FooCorp' },
        roles: [{ id: 'role_1', name: 'member' }],
      });
      expect(out.user.authenticationFactors).toEqual([{ id: 'fac_1', lastVerifiedAt: null }]);
    });

    it('errors not_found when the user does not exist', async () => {
      respondWith({ userlandUser: null });
      const err = await expectExit(runUserGet('user_missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('list', () => {
    it('lists users in human mode with a Verified column', async () => {
      respondWith({ userlandUsers: { data: [USER_NODE], listMetadata: { before: null, after: null } } });
      await runUserList({});
      const out = consoleOutput.join('\n');
      expect(out).toContain('jane@example.com');
      expect(out).toContain('Yes');
    });

    it('sends the resolved environment as variable AND header (read: no pre-validation fetch)', async () => {
      respondWith({ userlandUsers: { data: [], listMetadata: { before: null, after: null } } });
      await runUserList({});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUsers'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });

    it('maps --email to search and pagination flags to catalog variables', async () => {
      respondWith({ userlandUsers: { data: [], listMetadata: { before: null, after: null } } });
      await runUserList({ email: 'jane@', limit: 5, before: 'cursor_b', order: 'asc' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUsers'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile', search: 'jane@', limit: 5, before: 'cursor_b', order: 'Asc' },
        environmentId: 'env_profile',
      });
    });

    it('rejects an invalid --order before any request', async () => {
      const err = await expectExit(runUserList({ order: 'sideways' }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('honors an --environment-id override', async () => {
      respondWith({ userlandUsers: { data: [], listMetadata: { before: null, after: null } } });
      await runUserList({ environmentId: 'env_flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandUsers'), {
        token: 'tok_123',
        variables: { environmentId: 'env_flag' },
        environmentId: 'env_flag',
      });
    });

    it('handles empty results', async () => {
      respondWith({ userlandUsers: { data: [], listMetadata: { before: null, after: null } } });
      await runUserList({});
      expect(consoleOutput.some((l) => l.includes('No users found'))).toBe(true);
    });

    it('--json emits the documented curated shape (no list_metadata, no internal fields)', async () => {
      setOutputMode('json');
      respondWith({ userlandUsers: { data: [USER_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
      await runUserList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['users', 'pagination']);
      expect(Object.keys(out.users[0])).toEqual(USER_SHAPE_KEYS);
      expect(out.users[0]).not.toHaveProperty('googleOauthProfile');
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });
  });

  describe('update', () => {
    const updated = {
      updateUserlandUser: {
        __typename: 'UserlandUserUpdated',
        userlandUser: { id: 'user_1', email: 'jane@example.com', firstName: 'Janet', lastName: 'Doe' },
      },
    };

    it('requires at least one update flag', async () => {
      const err = await expectExit(runUserUpdate('user_1', {}), 1);
      expect(err.context?.errorCode).toBe('missing_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('maps flags into the input and pre-validates the environment first', async () => {
      respondWith(updated);
      await runUserUpdate('user_1', { firstName: 'Janet', locale: 'fr-FR' });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(mockGraphqlRequest.mock.calls.length).toBe(2);
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('updateUserlandUser');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { userlandUserId: 'user_1', firstName: 'Janet', locale: 'fr-FR' } },
        environmentId: 'env_profile',
      });
    });

    it('errors not_found on a missing user', async () => {
      respondWith({ updateUserlandUser: { __typename: 'UserlandUserNotFound' } });
      const err = await expectExit(runUserUpdate('user_1', { firstName: 'X' }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors cleanly on an email-change failure without echoing internal naming', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondWith({ updateUserlandUser: { __typename: 'UserlandUserChangeEmailError', reason: 'UserlandEmailTaken' } });
      const err = await expectExit(runUserUpdate('user_1', { email: 'taken@example.com' }), 1);
      expect(err.context?.errorCode).toBe('email_change_failed');
      expect(consoleErrors.join('\n')).not.toMatch(/graphql|userland/i);
    });

    it('errors when the external ID is already used', async () => {
      respondWith({ updateUserlandUser: { __typename: 'ExternalIDAlreadyUsed', externalId: 'ext_1' } });
      const err = await expectExit(runUserUpdate('user_1', { externalId: 'ext_1' }), 1);
      expect(err.context?.errorCode).toBe('external_id_in_use');
    });

    it('--json emits the updated { user } subset', async () => {
      setOutputMode('json');
      respondWith(updated);
      await runUserUpdate('user_1', { firstName: 'Janet' });
      const out = JSON.parse(consoleOutput[0]);
      expect(out).toEqual({ user: { id: 'user_1', email: 'jane@example.com', firstName: 'Janet', lastName: 'Doe' } });
    });
  });

  describe('delete (destructive)', () => {
    const deleted = { deleteUserlandUser: { __typename: 'UserlandUserDeleted' } };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runUserDelete('user_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes and sends the delete input', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(deleted);
      await runUserDelete('user_1', { yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { userlandUserId: 'user_1' } },
        environmentId: 'env_profile',
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith(deleted);
      await runUserDelete('user_1', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runUserDelete('user_1', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('errors not_found when the user does not exist', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      respondWith({ deleteUserlandUser: { __typename: 'UserlandUserNotFound' } });
      const err = await expectExit(runUserDelete('user_missing', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith(deleted);
      await runUserDelete('user_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'user_1' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runUserList({}), 4);
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
      await expectExit(runUserList({}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
