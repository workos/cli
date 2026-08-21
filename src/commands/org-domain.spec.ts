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
const { runOrgDomainGet, runOrgDomainCreate, runOrgDomainVerify, runOrgDomainDelete, ORG_DOMAIN_GET_SCAN_LIMIT } =
  await import('./org-domain.js');

const TEAM_ENVIRONMENTS_PAYLOAD = {
  currentTeam: {
    projectsV2: [{ environments: [{ id: 'env_profile', name: 'Sandbox', sandbox: true, clientId: null }] }],
  },
};

/** Route the wire mock by document (session.spec.ts recipe). */
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

/** The authoritative curated org-domain JSON shape (documented contract). */
const ORG_DOMAIN_SHAPE_KEYS = [
  'id',
  'domain',
  'state',
  'organizationId',
  'subdomain',
  'verificationStrategy',
  'verificationContent',
  'domainCaptureEnabled',
];

const DOMAIN_NODE = {
  id: 'org_domain_1',
  domain: 'example.com',
  state: 'Verified',
  subdomain: null,
  verificationContent: 'workos-verify=abc123',
  verificationStrategy: 'Dns',
  domainCaptureEnabled: false,
  domainCaptureEnabledBy: null,
};

describe('org-domain command', () => {
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

  describe('get (capped client-side scan)', () => {
    it('finds a domain in the organizations page with the environment header (read: no pre-validation fetch)', async () => {
      respondWith({
        organizations: {
          data: [
            { id: 'org_other', domains: [{ ...DOMAIN_NODE, id: 'org_domain_other', domain: 'other.com' }] },
            { id: 'org_1', domains: [DOMAIN_NODE] },
          ],
          listMetadata: { before: null, after: null },
        },
      });
      await runOrgDomainGet('org_domain_1', {});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('organizations'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile', limit: ORG_DOMAIN_GET_SCAN_LIMIT },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('org_domain_1');
      expect(out).toContain('example.com');
      expect(out).toContain('org_1');
    });

    it('misses loudly with the scan-cap wording', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      respondWith({
        organizations: { data: [{ id: 'org_1', domains: [] }], listMetadata: { before: null, after: null } },
      });
      const err = await expectExit(runOrgDomainGet('org_domain_missing', {}), 1);
      expect(err.context?.errorCode).toBe('not_found');
      expect(consoleErrors.join('\n')).toContain(`first ${ORG_DOMAIN_GET_SCAN_LIMIT} organizations`);
    });

    it('honors an --environment-id override', async () => {
      respondWith({
        organizations: { data: [{ id: 'org_1', domains: [DOMAIN_NODE] }], listMetadata: { before: null, after: null } },
      });
      await runOrgDomainGet('org_domain_1', { environmentId: 'env_flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('organizations'), {
        token: 'tok_123',
        variables: { environmentId: 'env_flag', limit: ORG_DOMAIN_GET_SCAN_LIMIT },
        environmentId: 'env_flag',
      });
    });

    it('--json emits the documented curated shape', async () => {
      setOutputMode('json');
      respondWith({
        organizations: { data: [{ id: 'org_1', domains: [DOMAIN_NODE] }], listMetadata: { before: null, after: null } },
      });
      await runOrgDomainGet('org_domain_1', {});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['domain']);
      expect(Object.keys(out.domain)).toEqual(ORG_DOMAIN_SHAPE_KEYS);
      expect(out.domain).toEqual({
        id: 'org_domain_1',
        domain: 'example.com',
        state: 'verified',
        organizationId: 'org_1',
        subdomain: null,
        verificationStrategy: 'dns',
        verificationContent: 'workos-verify=abc123',
        domainCaptureEnabled: false,
      });
    });
  });

  describe('create', () => {
    const added = {
      addDomains: {
        __typename: 'DomainsAdded',
        domains: [{ id: 'org_domain_1', state: 'Verified', domain: 'example.com', verificationStrategy: 'Manual' }],
      },
    };

    it('passes a one-element domain list, pre-validating the environment first (mutation ordering)', async () => {
      respondWith(added);
      await runOrgDomainCreate('example.com', { org: 'org_1' });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('addDomains');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { input: { organizationId: 'org_1', domains: ['example.com'] } },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('example.com');
      // Pin the added-as-verified divergence copy: the printed state is the
      // loudness mechanism for the REST→dashboard create divergence.
      expect(out).toContain('state: verified');
    });

    it('errors domain_in_use when another organization holds the domain', async () => {
      respondWith({
        addDomains: {
          __typename: 'OrganizationDomainAlreadyInUse',
          domain: 'example.com',
          organization: { name: 'FooCorp' },
        },
      });
      const err = await expectExit(runOrgDomainCreate('example.com', { org: 'org_1' }), 1);
      expect(err.context?.errorCode).toBe('domain_in_use');
    });

    it('errors consumer_domain_forbidden for consumer email domains', async () => {
      respondWith({ addDomains: { __typename: 'ConsumerDomainForbidden', domain: 'gmail.com' } });
      const err = await expectExit(runOrgDomainCreate('gmail.com', { org: 'org_1' }), 1);
      expect(err.context?.errorCode).toBe('consumer_domain_forbidden');
    });

    it('errors domain_pending when a non-verified copy already exists on the organization', async () => {
      respondWith({
        addDomains: {
          __typename: 'ExistingNonVerifiedDomain',
          nonVerifiedDomain: { state: 'Pending', domain: 'example.com' },
        },
      });
      const err = await expectExit(runOrgDomainCreate('example.com', { org: 'org_1' }), 1);
      expect(err.context?.errorCode).toBe('domain_pending');
    });

    it('errors unexpected_result on an unknown variant', async () => {
      respondWith({ addDomains: { __typename: 'SomethingElse' } });
      const err = await expectExit(runOrgDomainCreate('example.com', { org: 'org_1' }), 1);
      expect(err.context?.errorCode).toBe('unexpected_result');
    });

    it('--json emits { domain } with the organization threaded in', async () => {
      setOutputMode('json');
      respondWith(added);
      await runOrgDomainCreate('example.com', { org: 'org_1' });
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out)).toEqual(['domain']);
      expect(Object.keys(out.domain)).toEqual(ORG_DOMAIN_SHAPE_KEYS);
      expect(out.domain).toMatchObject({
        id: 'org_domain_1',
        domain: 'example.com',
        state: 'verified',
        organizationId: 'org_1',
        verificationStrategy: 'manual',
      });
    });
  });

  describe('verify (restart verification)', () => {
    const restarted = {
      restartOrganizationDomainVerification: { ...DOMAIN_NODE, state: 'Pending' },
    };

    it('restarts verification by ID, pre-validating the environment first', async () => {
      respondWith(restarted);
      await runOrgDomainVerify('org_domain_1', {});
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('restartOrganizationDomainVerification');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { id: 'org_domain_1' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('example.com');
      expect(out).toContain('workos-verify=abc123');
    });

    it('--json emits { domain } (no organization on the mutation payload)', async () => {
      setOutputMode('json');
      respondWith(restarted);
      await runOrgDomainVerify('org_domain_1', {});
      const out = JSON.parse(consoleOutput[0]);
      expect(Object.keys(out)).toEqual(['domain']);
      expect(Object.keys(out.domain)).toEqual(ORG_DOMAIN_SHAPE_KEYS);
      expect(out.domain).toMatchObject({ id: 'org_domain_1', state: 'pending', organizationId: null });
    });
  });

  describe('delete (destructive)', () => {
    const deleted = { deleteOrganizationDomain: { id: 'org_domain_1' } };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runOrgDomainDelete('org_domain_1', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in CI mode without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runOrgDomainDelete('org_domain_1', {}), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes, pre-validating the environment first', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(deleted);
      await runOrgDomainDelete('org_domain_1', { yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('deleteOrganizationDomain');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { id: 'org_domain_1' },
        environmentId: 'env_profile',
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith(deleted);
      await runOrgDomainDelete('org_domain_1', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runOrgDomainDelete('org_domain_1', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith(deleted);
      await runOrgDomainDelete('org_domain_1', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'org_domain_1' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runOrgDomainGet('org_domain_1', {}), 4);
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
      // Use the read path: mutation paths hit the environment pre-validation
      // fetch first, whose failure the resolver reports in its own copy.
      await expectExit(runOrgDomainGet('org_domain_1', {}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
