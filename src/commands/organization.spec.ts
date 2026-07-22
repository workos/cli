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
const { runOrgCreate, runOrgUpdate, runOrgGet, runOrgList, runOrgDelete, parseDomainArgs } =
  await import('./organization.js');

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

/** The authoritative curated organization JSON shape (documented contract). */
const ORGANIZATION_SHAPE_KEYS = [
  'id',
  'name',
  'createdAt',
  'usersCount',
  'allowProfilesOutsideOrganization',
  'externalId',
  'domains',
  'metadata',
];

const ORG_NODE = {
  id: 'org_1',
  name: 'FooCorp',
  createdAt: '2026-01-01T00:00:00.000Z',
  usersCount: 3,
  allowProfilesOutsideOrganization: false,
  externalId: null,
  metadata: [],
  domains: [{ id: 'dom_1', domain: 'foo.com', state: 'verified' }],
  // Internal fields the curated shape must drop:
  seeded: false,
  stripeCustomerId: 'cus_internal',
};

describe('organization command', () => {
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

  describe('parseDomainArgs', () => {
    it('parses domain:state format', () => {
      expect(parseDomainArgs(['foo.com:verified'])).toEqual([{ domain: 'foo.com', state: 'verified' }]);
    });

    it('defaults state to verified', () => {
      expect(parseDomainArgs(['foo.com'])).toEqual([{ domain: 'foo.com', state: 'verified' }]);
    });

    it('parses multiple domains', () => {
      const result = parseDomainArgs(['foo.com:verified', 'bar.com:pending']);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ domain: 'bar.com', state: 'pending' });
    });

    it('returns empty array for no args', () => {
      expect(parseDomainArgs([])).toEqual([]);
    });

    it('rejects an unknown state', async () => {
      const err = await expectExit(Promise.resolve().then(() => parseDomainArgs(['foo.com:bogus'])), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
    });
  });

  describe('list', () => {
    it('lists organizations in human mode from the active environment', async () => {
      respondWith({ organizations: { data: [ORG_NODE], listMetadata: { before: null, after: null } } });
      await runOrgList({});
      const out = consoleOutput.join('\n');
      expect(out).toContain('FooCorp');
      expect(out).toContain('foo.com');
    });

    it('sends the resolved environment as variable AND header (read: no pre-validation fetch)', async () => {
      respondWith({ organizations: { data: [], listMetadata: { before: null, after: null } } });
      await runOrgList({});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('organizations'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
    });

    it('maps --domain to search and pagination flags to catalog variables', async () => {
      respondWith({ organizations: { data: [], listMetadata: { before: null, after: null } } });
      await runOrgList({ domain: 'foo.com', limit: 5, after: 'cursor_a', order: 'desc' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('organizations'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile', search: 'foo.com', limit: 5, after: 'cursor_a', order: 'Desc' },
        environmentId: 'env_profile',
      });
    });

    it('honors an --environment-id override', async () => {
      respondWith({ organizations: { data: [], listMetadata: { before: null, after: null } } });
      await runOrgList({ environmentId: 'env_flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('organizations'), {
        token: 'tok_123',
        variables: { environmentId: 'env_flag' },
        environmentId: 'env_flag',
      });
    });

    it('rejects an invalid --order before any request', async () => {
      const err = await expectExit(runOrgList({ order: 'sideways' }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('handles empty results', async () => {
      respondWith({ organizations: { data: [], listMetadata: { before: null, after: null } } });
      await runOrgList({});
      expect(consoleOutput.some((l) => l.includes('No organizations found'))).toBe(true);
    });

    it('shows pagination cursors in human mode', async () => {
      respondWith({ organizations: { data: [ORG_NODE], listMetadata: { before: 'cursor_b', after: 'cursor_a' } } });
      await runOrgList({});
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });

    it('--json emits the documented curated shape (no list_metadata, no internal fields)', async () => {
      setOutputMode('json');
      respondWith({ organizations: { data: [ORG_NODE], listMetadata: { before: null, after: 'cursor_a' } } });
      await runOrgList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['organizations', 'pagination']);
      expect(Object.keys(out.organizations[0])).toEqual(ORGANIZATION_SHAPE_KEYS);
      expect(out.organizations[0]).not.toHaveProperty('stripeCustomerId');
      expect(out.organizations[0].domains[0]).toEqual({ id: 'dom_1', domain: 'foo.com', state: 'verified' });
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });
  });

  describe('get', () => {
    it('fetches by ID with the environment header and renders fields', async () => {
      respondWith({ organization: ORG_NODE });
      await runOrgGet('org_1');
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('organization'), {
        token: 'tok_123',
        variables: { id: 'org_1' },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.join('\n')).toContain('FooCorp');
    });

    it('--json emits { organization } in the curated shape', async () => {
      setOutputMode('json');
      respondWith({ organization: ORG_NODE });
      await runOrgGet('org_1');
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out)).toEqual(['organization']);
      expect(Object.keys(out.organization)).toEqual(ORGANIZATION_SHAPE_KEYS);
      expect(out.organization.id).toBe('org_1');
    });

    it('errors not_found when the organization does not exist', async () => {
      respondWith({ organization: null });
      const err = await expectExit(runOrgGet('org_missing'), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });
  });

  describe('create', () => {
    const created = {
      createOrganization: {
        __typename: 'OrganizationCreated',
        organization: { id: 'org_1', name: 'Test', domains: [] },
      },
    };

    it('maps name + domains into the input and pre-validates the environment first', async () => {
      respondWith(created);
      await runOrgCreate('Test', ['foo.com', 'bar.com']);
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(mockGraphqlRequest.mock.calls.length).toBe(2);
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('createOrganization');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: {
          input: { environmentId: 'env_profile', name: 'Test', domains: ['foo.com', 'bar.com'], domainsDeveloperVerified: true },
        },
        environmentId: 'env_profile',
      });
    });

    it('maps all-pending domains to domainsDeveloperVerified: false', async () => {
      respondWith(created);
      await runOrgCreate('Test', ['foo.com:pending']);
      const variables = mockGraphqlRequest.mock.calls[1][1] as {
        variables: { input: { domains: string[]; domainsDeveloperVerified: boolean } };
      };
      expect(variables.variables.input.domainsDeveloperVerified).toBe(false);
    });

    it('rejects mixed domain states before any request', async () => {
      const err = await expectExit(runOrgCreate('Test', ['foo.com:verified', 'bar.com:pending']), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('omits domain fields when no domains are given', async () => {
      respondWith(created);
      await runOrgCreate('Test', []);
      const variables = mockGraphqlRequest.mock.calls[1][1] as { variables: { input: Record<string, unknown> } };
      expect(variables.variables.input).toEqual({ environmentId: 'env_profile', name: 'Test' });
    });

    it('reports success in human mode', async () => {
      respondWith(created);
      await runOrgCreate('Test', []);
      const out = consoleOutput.join('\n');
      expect(out).toContain('Created organization');
      expect(out).toContain('org_1');
    });

    it('errors when a domain is already in use', async () => {
      respondWith({
        createOrganization: {
          __typename: 'OrganizationDomainAlreadyInUse',
          domain: 'foo.com',
          organization: { id: 'org_2', name: 'Other' },
        },
      });
      const err = await expectExit(runOrgCreate('Test', ['foo.com']), 1);
      expect(err.context?.errorCode).toBe('domain_in_use');
    });

    it('errors on a consumer email domain', async () => {
      respondWith({ createOrganization: { __typename: 'ConsumerDomainForbidden', domain: 'gmail.com' } });
      const err = await expectExit(runOrgCreate('Test', ['gmail.com']), 1);
      expect(err.context?.errorCode).toBe('consumer_domain_forbidden');
    });

    it('--json emits { organization } in the curated shape', async () => {
      setOutputMode('json');
      respondWith(created);
      await runOrgCreate('Test', []);
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out)).toEqual(['organization']);
      expect(Object.keys(out.organization)).toEqual(ORGANIZATION_SHAPE_KEYS);
      expect(out.organization.name).toBe('Test');
    });
  });

  describe('update', () => {
    const updated = {
      updateOrganization: {
        __typename: 'UpdateOrganizationPayload',
        organization: { id: 'org_1', name: 'Updated', domains: [{ id: 'dom_1', domain: 'foo.com', state: 'pending' }] },
      },
    };

    it('sends flat variables (id, name) and pre-validates the environment first', async () => {
      respondWith(updated);
      await runOrgUpdate('org_1', 'Updated');
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { id: 'org_1', name: 'Updated' },
        environmentId: 'env_profile',
      });
    });

    it('maps a domain + state onto domains/domainsDeveloperVerified', async () => {
      respondWith(updated);
      await runOrgUpdate('org_1', 'Updated', { domain: 'foo.com', state: 'pending' });
      const variables = mockGraphqlRequest.mock.calls[1][1] as { variables: Record<string, unknown> };
      expect(variables.variables).toEqual({
        id: 'org_1',
        name: 'Updated',
        domains: ['foo.com'],
        domainsDeveloperVerified: false,
      });
    });

    it('errors when the external ID is already used', async () => {
      respondWith({ updateOrganization: { __typename: 'ExternalIDAlreadyUsed', externalId: 'ext_1' } });
      const err = await expectExit(runOrgUpdate('org_1', 'Updated'), 1);
      expect(err.context?.errorCode).toBe('external_id_in_use');
    });

    it('reports success in human mode', async () => {
      respondWith(updated);
      await runOrgUpdate('org_1', 'Updated');
      expect(consoleOutput.join('\n')).toContain('Updated organization');
    });

    it('--json emits { organization } in the curated shape', async () => {
      setOutputMode('json');
      respondWith(updated);
      await runOrgUpdate('org_1', 'Updated');
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out.organization)).toEqual(ORGANIZATION_SHAPE_KEYS);
      expect(out.organization.name).toBe('Updated');
    });
  });

  describe('delete (destructive)', () => {
    const deleted = { deleteOrganization: { organization: { id: 'org_1' } } };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runOrgDelete('org_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in CI mode without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runOrgDelete('org_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes and sends the delete input', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      respondWith(deleted);
      await runOrgDelete('org_1', { yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { organizationId: 'org_1' } },
        environmentId: 'env_profile',
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith(deleted);
      await runOrgDelete('org_1', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runOrgDelete('org_1', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('requires --yes in JSON mode even interactively', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      setOutputMode('json');
      const err = await expectExit(runOrgDelete('org_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith(deleted);
      await runOrgDelete('org_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'org_1' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runOrgList({}), 4);
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
      await expectExit(runOrgList({}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });

    it('never calls the operation when the environment target cannot be resolved', async () => {
      mockGetActiveEnvironment.mockReturnValue(undefined);
      mockGetConfig.mockReturnValue(undefined);
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      // Resolver falls through flag → profile → team fetch; the fetch fails.
      mockGraphqlRequest.mockRejectedValue(new Error('network down'));
      const err = await expectExit(runOrgList({}), 1);
      expect(err.context?.errorCode).toBe('environment_unresolved');
      // Only the resolver's team fetch went out — never the operation.
      expect(mockGraphqlRequest.mock.calls.every(([doc]) => String(doc).includes('teamProjectsV2'))).toBe(true);
    });
  });
});
