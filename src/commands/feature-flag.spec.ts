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

vi.mock('../utils/clack.js', () => ({
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
  runFeatureFlagList,
  runFeatureFlagGet,
  runFeatureFlagEnable,
  runFeatureFlagDisable,
  runFeatureFlagAddTarget,
  runFeatureFlagRemoveTarget,
} = await import('./feature-flag.js');

// Projects carry IDs so the flag commands can derive the active environment's
// project (the flag operations are project-scoped).
const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [
      { id: 'proj_1', environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] },
      { id: 'proj_2', environments: [{ id: 'env_other', name: 'Other', sandbox: false, clientId: null }] },
    ],
  },
};

const FLAG_ENVIRONMENT_NODE = {
  id: 'fe_1',
  environmentId: 'env_profile',
  flagId: 'flag_1',
  flagEnabled: false,
  defaultEnabled: true,
  accessType: 'SOME',
  organizations: [{ id: 'org_1', name: 'FooCorp' }],
  users: [{ id: 'user_1', email: 'a@example.com', firstName: 'A', lastName: 'B' }],
  uniqueUsersCount: 1,
};

const FLAG_NODE = {
  id: 'flag_1',
  name: 'Beta',
  slug: 'beta',
  description: 'Beta feature',
  projectId: 'proj_1',
  owner: null,
  flagEnvironments: [
    FLAG_ENVIRONMENT_NODE,
    // A different environment's state the curated shapes must NOT report:
    { id: 'fe_2', environmentId: 'env_other', flagId: 'flag_1', flagEnabled: true },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
  tags: [{ id: 'tag_1', name: 'beta-wave' }],
};

interface RouteMap {
  list?: unknown;
  flagBySlug?: unknown;
  updateFlagEnvironment?: unknown;
}

/**
 * Route the wire mock by document: `teamProjectsV2` serves BOTH the
 * environment resolver's pre-validation fetch and the project derivation;
 * everything else gets its configured payload.
 */
function respondWith(routes: RouteMap): void {
  mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
    const text = String(doc);
    if (text.includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
    if (text.includes('mutation updateFlagEnvironment')) return routes.updateFlagEnvironment;
    if (text.includes('flagBySlug')) return routes.flagBySlug;
    if (text.includes('flagsForProject')) return routes.list;
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

/** The authoritative curated flag JSON shapes (documented contract). */
const FLAG_SHAPE_KEYS = ['id', 'slug', 'name', 'description', 'enabled', 'createdAt', 'updatedAt'];
const FLAG_DETAIL_SHAPE_KEYS = [
  ...FLAG_SHAPE_KEYS,
  'defaultEnabled',
  'accessType',
  'organizationTargets',
  'userTargets',
  'tags',
];

const UPDATED_PAYLOAD = {
  updateFlagEnvironment: {
    __typename: 'FlagEnvironmentUpdated',
    flagEnvironment: { ...FLAG_ENVIRONMENT_NODE, flagEnabled: true },
  },
};

const LIST_PAYLOAD = {
  flagsForProject: { data: [FLAG_NODE], listMetadata: { before: null, after: 'cursor_a' } },
};

/** Every subcommand's happy-path invocation, for the shared contract matrices. */
const SUBCOMMANDS: Array<{ name: string; routes: RouteMap; run: () => Promise<void> }> = [
  { name: 'list', routes: { list: LIST_PAYLOAD }, run: () => runFeatureFlagList({}) },
  { name: 'get', routes: { flagBySlug: { flagBySlug: FLAG_NODE } }, run: () => runFeatureFlagGet('beta') },
  {
    name: 'enable',
    routes: { flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD },
    run: () => runFeatureFlagEnable('beta'),
  },
  {
    name: 'disable',
    routes: { flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD },
    run: () => runFeatureFlagDisable('beta'),
  },
  {
    name: 'add-target',
    routes: { flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD },
    run: () => runFeatureFlagAddTarget('beta', 'user_2'),
  },
  {
    name: 'remove-target',
    routes: { flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD },
    run: () => runFeatureFlagRemoveTarget('beta', 'user_1'),
  },
];

describe('feature-flag command', () => {
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
    it('derives the project from the active environment, then lists flags', async () => {
      respondWith({ list: LIST_PAYLOAD });
      await runFeatureFlagList({});
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs[1]).toContain('flagsForProject');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { projectId: 'proj_1' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('beta');
      // The ACTIVE environment's state (fe_1) is disabled, even though another
      // environment has the flag on.
      expect(out).toContain('No');
    });

    it('maps pagination flags to catalog variables', async () => {
      respondWith({ list: { flagsForProject: { data: [], listMetadata: { before: null, after: null } } } });
      await runFeatureFlagList({ limit: 5, after: 'cursor_a', order: 'desc' });
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { projectId: 'proj_1', limit: 5, after: 'cursor_a', order: 'Desc' },
        environmentId: 'env_profile',
      });
    });

    it('rejects an invalid --order value', async () => {
      const err = await expectExit(runFeatureFlagList({ order: 'sideways' }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits the curated shape with the active environment state', async () => {
      setOutputMode('json');
      respondWith({ list: LIST_PAYLOAD });
      await runFeatureFlagList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|flagEnvironments|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['flags', 'pagination']);
      expect(Object.keys(out.flags[0])).toEqual(FLAG_SHAPE_KEYS);
      expect(out.flags[0]).toMatchObject({ slug: 'beta', enabled: false });
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });

    it('errors environment_stale when the environment joins no project', async () => {
      mockGetActiveEnvironment.mockReturnValue({ apiKey: 'sk_ignored', environmentId: 'env_gone' });
      mockGetConfig.mockReturnValue({
        activeEnvironment: 'default',
        environments: { default: { apiKey: 'sk_ignored', environmentId: 'env_gone' } },
      });
      respondWith({});
      const err = await expectExit(runFeatureFlagList({}), 1);
      expect(err.context?.errorCode).toBe('environment_stale');
    });

    it('handles empty results', async () => {
      respondWith({ list: { flagsForProject: { data: [], listMetadata: { before: null, after: null } } } });
      await runFeatureFlagList({});
      expect(consoleOutput.some((line) => line.includes('No feature flags found'))).toBe(true);
    });
  });

  describe('get', () => {
    it('fetches by slug within the derived project', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE } });
      await runFeatureFlagGet('beta');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { projectId: 'proj_1', slug: 'beta' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('beta');
      expect(out).toContain('No'); // active environment's state
    });

    it('--json emits { flag } with the active environment targeting', async () => {
      setOutputMode('json');
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE } });
      await runFeatureFlagGet('beta');
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|flagEnvironments/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['flag']);
      expect(Object.keys(out.flag)).toEqual(FLAG_DETAIL_SHAPE_KEYS);
      expect(out.flag).toMatchObject({
        slug: 'beta',
        enabled: false,
        defaultEnabled: true,
        accessType: 'SOME',
        organizationTargets: [{ id: 'org_1', name: 'FooCorp' }],
        userTargets: [{ id: 'user_1', email: 'a@example.com' }],
        tags: ['beta-wave'],
      });
    });

    it('errors not_found when the flag does not exist', async () => {
      respondWith({ flagBySlug: { flagBySlug: null } });
      const err = await expectExit(runFeatureFlagGet('missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('enable / disable (read-merge-write)', () => {
    it('enable fetches the flag and sends the FULL current state with flagEnabled true', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagEnable('beta');
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      // Mutation: resolver pre-validation, project derivation, lookup, update.
      expect(docs[0]).toContain('teamProjectsV2');
      expect(docs.at(-2)).toContain('flagBySlug');
      expect(docs.at(-1)).toContain('mutation updateFlagEnvironment');
      // The update REPLACES target lists server-side — the full current
      // targeting must ride along or it would be silently cleared.
      expect(mockGraphqlRequest.mock.calls.at(-1)![1]).toEqual({
        token: 'tok_123',
        variables: {
          input: {
            flagEnvironmentId: 'fe_1',
            flagEnabled: true,
            defaultEnabled: true,
            accessType: 'SOME',
            organizationIds: ['org_1'],
            userIds: ['user_1'],
          },
        },
        environmentId: 'env_profile',
      });
    });

    it('enable prints a success message in human mode', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagEnable('beta');
      expect(consoleOutput.join('\n')).toContain('Enabled feature flag');
    });

    it('disable prints a success message in human mode', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagDisable('beta');
      expect(consoleOutput.join('\n')).toContain('Disabled feature flag');
    });

    it('errors not_found on the FlagEnvironmentNotFound mutation variant', async () => {
      respondWith({
        flagBySlug: { flagBySlug: FLAG_NODE },
        updateFlagEnvironment: {
          updateFlagEnvironment: { __typename: 'FlagEnvironmentNotFound', flagEnvironmentId: 'fe_1' },
        },
      });
      const err = await expectExit(runFeatureFlagEnable('beta'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('enable --json emits { enabled }', async () => {
      setOutputMode('json');
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagEnable('beta');
      expect(JSON.parse(consoleOutput[0])).toEqual({ enabled: 'beta' });
    });

    it('disable sends flagEnabled false, preserving targeting', async () => {
      setOutputMode('json');
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagDisable('beta');
      const input = (mockGraphqlRequest.mock.calls.at(-1)![1] as { variables: { input: Record<string, unknown> } })
        .variables.input;
      expect(input).toMatchObject({
        flagEnvironmentId: 'fe_1',
        flagEnabled: false,
        organizationIds: ['org_1'],
        userIds: ['user_1'],
      });
      expect(JSON.parse(consoleOutput[0])).toEqual({ disabled: 'beta' });
    });

    it('errors not_found when the flag has no state in the active environment', async () => {
      respondWith({ flagBySlug: { flagBySlug: { ...FLAG_NODE, flagEnvironments: [] } } });
      const err = await expectExit(runFeatureFlagEnable('beta'), 1);
      expect(err.context?.errorCode).toBe('not_found');
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs.some((doc) => doc.includes('mutation updateFlagEnvironment'))).toBe(false);
    });

    it('errors not_found when the flag does not exist', async () => {
      respondWith({ flagBySlug: { flagBySlug: null } });
      const err = await expectExit(runFeatureFlagDisable('missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('add-target / remove-target (prefix-typed, read-merge-write)', () => {
    it('add-target user_* merges into userIds', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagAddTarget('beta', 'user_2');
      const input = (mockGraphqlRequest.mock.calls.at(-1)![1] as { variables: { input: Record<string, unknown> } })
        .variables.input;
      expect(input).toMatchObject({
        flagEnabled: false, // preserved, not toggled
        organizationIds: ['org_1'],
        userIds: ['user_1', 'user_2'],
      });
    });

    it('add-target org_* merges into organizationIds', async () => {
      setOutputMode('json');
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagAddTarget('beta', 'org_2');
      const input = (mockGraphqlRequest.mock.calls.at(-1)![1] as { variables: { input: Record<string, unknown> } })
        .variables.input;
      expect(input).toMatchObject({
        organizationIds: ['org_1', 'org_2'],
        userIds: ['user_1'],
      });
      expect(JSON.parse(consoleOutput[0])).toEqual({ added: { flag: 'beta', targetId: 'org_2' } });
    });

    it('add-target is idempotent for an existing target', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagAddTarget('beta', 'user_1');
      const input = (mockGraphqlRequest.mock.calls.at(-1)![1] as { variables: { input: Record<string, unknown> } })
        .variables.input;
      expect(input).toMatchObject({ userIds: ['user_1'] });
    });

    it('rejects a target ID with an unknown prefix before any request', async () => {
      const err = await expectExit(runFeatureFlagAddTarget('beta', 'conn_123'), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('remove-target filters the list', async () => {
      setOutputMode('json');
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagRemoveTarget('beta', 'user_1');
      const input = (mockGraphqlRequest.mock.calls.at(-1)![1] as { variables: { input: Record<string, unknown> } })
        .variables.input;
      expect(input).toMatchObject({ userIds: [], organizationIds: ['org_1'] });
      expect(JSON.parse(consoleOutput[0])).toEqual({ removed: { flag: 'beta', targetId: 'user_1' } });
    });

    it('add-target prints a success message in human mode', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagAddTarget('beta', 'user_2');
      expect(consoleOutput.join('\n')).toContain('Added target');
    });

    it('remove-target prints a success message in human mode', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE }, updateFlagEnvironment: UPDATED_PAYLOAD });
      await runFeatureFlagRemoveTarget('beta', 'user_1');
      expect(consoleOutput.join('\n')).toContain('Removed target');
    });

    it('remove-target errors not_found when the flag has no state in this environment', async () => {
      respondWith({ flagBySlug: { flagBySlug: { ...FLAG_NODE, flagEnvironments: [] } } });
      const err = await expectExit(runFeatureFlagRemoveTarget('beta', 'user_1'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('remove-target errors not_found when the target is not assigned', async () => {
      respondWith({ flagBySlug: { flagBySlug: FLAG_NODE } });
      const err = await expectExit(runFeatureFlagRemoveTarget('beta', 'user_9'), 1);
      expect(err.context?.errorCode).toBe('not_found');
      const docs = mockGraphqlRequest.mock.calls.map((call) => String(call[0]));
      expect(docs.some((doc) => doc.includes('mutation updateFlagEnvironment'))).toBe(false);
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
      // The team projects fetch stays healthy (resolver pre-validation and
      // project derivation); the flag operation is what the gate rejects.
      mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
        if (String(doc).includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
        throw new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', 'forbidden', 403);
      });
      await expectExit(run(), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
