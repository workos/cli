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
const { runSessionList, runSessionRevoke } = await import('./session.js');

const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [
      {
        environments: [
          { id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null },
          { id: 'env_flag', name: 'Override', sandbox: true, clientId: null },
        ],
      },
    ],
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

/** The authoritative curated session JSON shape (documented contract). */
const SESSION_SHAPE_KEYS = [
  'id',
  'state',
  'createdAt',
  'updatedAt',
  'expiresAt',
  'endedAt',
  'ipAddress',
  'userAgent',
  'provider',
  'organization',
  'impersonator',
];

const SESSION_NODE = {
  __typename: 'UserlandSession',
  id: 'session_1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  ipAddress: '203.0.113.7',
  userAgent: 'Mozilla/5.0',
  provider: 'Password',
  impersonator: null,
  impersonationReason: null,
  organization: { id: 'org_1', name: 'FooCorp' },
  application: { id: 'app_1', name: 'Web' },
  state: { __typename: 'UserlandSessionIssued', expiresAt: '2026-03-01T00:00:00.000Z' },
};

describe('session command', () => {
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
    it('validates the environment, then lists sessions with its header', async () => {
      respondWith({
        userlandUser: {
          id: 'user_1',
          sessions: { data: [SESSION_NODE], listMetadata: { before: null, after: null } },
        },
      });
      await runSessionList('user_1', {});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(2);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandSessions'), {
        token: 'tok_123',
        variables: { userId: 'user_1' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('session_1');
      expect(out).toContain('203.0.113.7');
      expect(out).toContain('active');
    });

    it('maps pagination flags to catalog variables', async () => {
      respondWith({
        userlandUser: { id: 'user_1', sessions: { data: [], listMetadata: { before: null, after: null } } },
      });
      await runSessionList('user_1', { limit: 5, after: 'cursor_a' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandSessions'), {
        token: 'tok_123',
        variables: { userId: 'user_1', limit: 5, after: 'cursor_a' },
        environmentId: 'env_profile',
      });
    });

    it('honors an --environment-id override', async () => {
      respondWith({
        userlandUser: { id: 'user_1', sessions: { data: [], listMetadata: { before: null, after: null } } },
      });
      await runSessionList('user_1', { environmentId: 'env_flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('userlandSessions'), {
        token: 'tok_123',
        variables: { userId: 'user_1' },
        environmentId: 'env_flag',
      });
    });

    it('errors not_found when the user does not exist', async () => {
      respondWith({ userlandUser: null });
      const err = await expectExit(runSessionList('user_missing', {}), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('handles empty results', async () => {
      respondWith({
        userlandUser: { id: 'user_1', sessions: { data: [], listMetadata: { before: null, after: null } } },
      });
      await runSessionList('user_1', {});
      expect(consoleOutput.some((l) => l.includes('No sessions found'))).toBe(true);
    });

    it('--json emits the documented curated shape with derived status', async () => {
      setOutputMode('json');
      respondWith({
        userlandUser: {
          id: 'user_1',
          sessions: {
            data: [
              SESSION_NODE,
              {
                ...SESSION_NODE,
                id: 'session_2',
                state: {
                  __typename: 'UserlandSessionRevoked',
                  expiresAt: '2026-03-01T00:00:00.000Z',
                  endedAt: '2026-02-01T00:00:00.000Z',
                },
              },
            ],
            listMetadata: { before: null, after: 'cursor_a' },
          },
        },
      });
      await runSessionList('user_1', {});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['sessions', 'pagination']);
      expect(Object.keys(out.sessions[0])).toEqual(SESSION_SHAPE_KEYS);
      expect(out.sessions[0]).toMatchObject({
        id: 'session_1',
        state: 'active',
        expiresAt: '2026-03-01T00:00:00.000Z',
        endedAt: null,
        organization: { id: 'org_1', name: 'FooCorp' },
      });
      expect(out.sessions[1]).toMatchObject({
        id: 'session_2',
        state: 'revoked',
        endedAt: '2026-02-01T00:00:00.000Z',
      });
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });
  });

  describe('revoke (destructive)', () => {
    const revoked = { revokeUserlandSession: { sessionId: 'session_1' } };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runSessionRevoke('session_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in CI mode without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runSessionRevoke('session_1', {}), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes, pre-validating the environment first', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(revoked);
      await runSessionRevoke('session_1', { yes: true });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('revokeUserlandSession');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { sessionId: 'session_1' } },
        environmentId: 'env_profile',
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith(revoked);
      await runSessionRevoke('session_1', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runSessionRevoke('session_1', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('errors revoke_failed when the result carries no session (unknown/miss variant)', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondWith({ revokeUserlandSession: {} });
      const err = await expectExit(runSessionRevoke('session_missing', { yes: true }), 1);
      expect(err.context?.errorCode).toBe('revoke_failed');
      expect(consoleErrors.join('\n')).not.toMatch(/graphql|userland/i);
    });

    it('--json emits { revoked }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith(revoked);
      await runSessionRevoke('session_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ revoked: 'session_1' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runSessionList('user_1', {}), 4);
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
      await expectExit(runSessionList('user_1', {}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
