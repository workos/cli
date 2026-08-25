import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
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
const { resetInteractionModeForTests } = await import('../utils/interaction-mode.js');
const { DashboardGraphqlError } = await import('../lib/dashboard-graphql.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runPortalGenerateLink } = await import('./portal.js');

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

/** The authoritative curated portal-setup-link JSON shape (documented contract). */
const PORTAL_LINK_SHAPE_KEYS = ['id', 'link', 'intents', 'state', 'expiresAt'];

const GENERATED = {
  generatePortalSetupLink: {
    __typename: 'PortalSetupLinkGenerated',
    portalSetupLink: {
      id: 'portal_setup_link_1',
      expiresAt: '2026-08-01T00:00:00Z',
      intents: ['Sso'],
      token: 'tok_setup',
      url: 'https://setup.workos.com/abc',
      state: 'Active',
    },
  },
};

describe('portal command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
    mockRequireCommandToken.mockResolvedValue('tok_123');
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

  describe('generate-link', () => {
    it('maps the CLI intent onto the operation input, pre-validating the environment first (mutation ordering)', async () => {
      respondWith(GENERATED);
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('generatePortalSetupLink');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        // expireIntents scopes expiry to the same intent — omitted, the server
        // would expire ALL of the organization's active setup links.
        variables: { input: { organizationId: 'org_123', intents: ['Sso'], expireIntents: ['Sso'] } },
        environmentId: 'env_profile',
      });
    });

    it('outputs the link URL and its expiry in human mode', async () => {
      respondWith(GENERATED);
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' });
      const out = consoleOutput.join('\n');
      expect(out).toContain('https://setup.workos.com/abc');
      expect(out).toContain('expires at 2026-08-01T00:00:00Z');
    });

    it.each([
      ['dsync', 'Dsync'],
      ['log_streams', 'LogStreams'],
      ['domain_verification', 'DomainVerification'],
      ['certificate_renewal', 'CertificateRenewal'],
    ])('maps intent %s to %s', async (cliIntent, opIntent) => {
      respondWith(GENERATED);
      await runPortalGenerateLink({ intent: cliIntent, organization: 'org_123' });
      expect(mockGraphqlRequest.mock.calls[1][1]).toMatchObject({
        variables: { input: { organizationId: 'org_123', intents: [opIntent], expireIntents: [opIntent] } },
      });
    });

    it('rejects audit_logs loudly (no equivalent on this plane) without calling the wire', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      const err = await expectExit(runPortalGenerateLink({ intent: 'audit_logs', organization: 'org_123' }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
      expect(consoleErrors.join('\n')).toContain('Supported intents');
    });

    it('rejects unknown intents with the supported set', async () => {
      const err = await expectExit(runPortalGenerateLink({ intent: 'nonsense', organization: 'org_123' }), 1);
      expect(err.context?.errorCode).toBe('invalid_argument');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('honors an --environment-id override', async () => {
      respondWith(GENERATED);
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123', environmentId: 'env_profile' });
      expect(mockGraphqlRequest.mock.calls[1][1]).toMatchObject({ environmentId: 'env_profile' });
    });

    it('errors not_found when the organization is unknown', async () => {
      respondWith({
        generatePortalSetupLink: { __typename: 'OrganizationNotFound', organizationId: 'org_missing' },
      });
      const err = await expectExit(runPortalGenerateLink({ intent: 'sso', organization: 'org_missing' }), 1);
      expect(err.context?.errorCode).toBe('not_found');
    });

    it('errors unexpected_result on an unknown variant', async () => {
      respondWith({ generatePortalSetupLink: { __typename: 'SomethingElse' } });
      const err = await expectExit(runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }), 1);
      expect(err.context?.errorCode).toBe('unexpected_result');
    });

    it('--json emits the documented curated shape with intents in CLI grammar', async () => {
      setOutputMode('json');
      respondWith(GENERATED);
      await runPortalGenerateLink({ intent: 'sso', organization: 'org_123' });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['portalSetupLink']);
      expect(Object.keys(out.portalSetupLink)).toEqual(PORTAL_LINK_SHAPE_KEYS);
      expect(out.portalSetupLink).toEqual({
        id: 'portal_setup_link_1',
        link: 'https://setup.workos.com/abc',
        intents: ['sso'],
        state: 'active',
        expiresAt: '2026-08-01T00:00:00Z',
      });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }), 4);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('surfaces the gated-capability case on a 403 without naming GraphQL', async () => {
      const consoleErrors: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        consoleErrors.push(args.map(String).join(' '));
      });
      mockGraphqlRequest.mockImplementation(async (doc: unknown) => {
        if (String(doc).includes('teamProjectsV2')) return TEAM_ENVIRONMENTS_PAYLOAD;
        throw new DashboardGraphqlError(
          'The dashboard GraphQL API rejected this session (HTTP 403).',
          'forbidden',
          403,
        );
      });
      await expectExit(runPortalGenerateLink({ intent: 'sso', organization: 'org_123' }), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
