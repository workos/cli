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
const { runWebhookList, runWebhookCreate, runWebhookDelete } = await import('./webhook.js');

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

/** The authoritative curated webhook-endpoint JSON shape (documented contract). */
const WEBHOOK_ENDPOINT_SHAPE_KEYS = ['id', 'url', 'events', 'state', 'createdAt'];

const ENDPOINT_NODE = {
  id: 'we_123',
  endpointUrl: 'https://example.com/hook',
  events: ['dsync.user.created'],
  state: 'Active',
  createdAt: '2024-01-01T00:00:00Z',
};

describe('webhook command', () => {
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
    it('lists endpoints with the environment variable + header (read: no pre-validation fetch)', async () => {
      respondWith({
        webhookEndpoints: { data: [ENDPOINT_NODE], listMetadata: { before: null, after: null } },
      });
      await runWebhookList({});
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('webhookEndpoints'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile' },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('we_123');
      expect(out).toContain('https://example.com/hook');
      expect(out).toContain('dsync.user.created');
    });

    it('handles empty results', async () => {
      respondWith({ webhookEndpoints: { data: [], listMetadata: { before: null, after: null } } });
      await runWebhookList({});
      expect(consoleOutput.some((l) => l.includes('No webhook endpoints found'))).toBe(true);
    });

    it('honors an --environment-id override', async () => {
      respondWith({ webhookEndpoints: { data: [], listMetadata: { before: null, after: null } } });
      await runWebhookList({ environmentId: 'env_flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('webhookEndpoints'), {
        token: 'tok_123',
        variables: { environmentId: 'env_flag' },
        environmentId: 'env_flag',
      });
    });

    it('truncates long event lists with a "+N more" suffix', async () => {
      respondWith({
        webhookEndpoints: {
          data: [
            {
              ...ENDPOINT_NODE,
              events: [
                'user.created',
                'user.updated',
                'user.deleted',
                'session.created',
                'session.revoked',
                'organization.created',
                'organization.updated',
              ],
            },
          ],
          listMetadata: { before: null, after: null },
        },
      });
      await runWebhookList({});
      expect(consoleOutput.some((l) => /\+\d+ more/.test(l))).toBe(true);
    });

    it('always shows at least one event when a single event name exceeds the budget', async () => {
      const longEvent = 'a.very.long.namespace.with.many.segments.that.exceeds.sixty.chars.event';
      respondWith({
        webhookEndpoints: {
          data: [{ ...ENDPOINT_NODE, events: [longEvent, 'user.created'] }],
          listMetadata: { before: null, after: null },
        },
      });
      await runWebhookList({});
      expect(consoleOutput.some((l) => l.includes(longEvent))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('(+1 more)'))).toBe(true);
    });

    it('--json emits the documented curated shape', async () => {
      setOutputMode('json');
      respondWith({
        webhookEndpoints: { data: [ENDPOINT_NODE], listMetadata: { before: null, after: 'cursor_a' } },
      });
      await runWebhookList({});
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['webhookEndpoints', 'pagination']);
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
      expect(Object.keys(out.webhookEndpoints[0])).toEqual(WEBHOOK_ENDPOINT_SHAPE_KEYS);
      expect(out.webhookEndpoints[0]).toEqual({
        id: 'we_123',
        url: 'https://example.com/hook',
        events: ['dsync.user.created'],
        state: 'Active',
        createdAt: '2024-01-01T00:00:00Z',
      });
    });
  });

  describe('create', () => {
    const created = { createWebhookEndpoint: { id: 'we_123' } };

    it('creates with url + events, pre-validating the environment first (mutation ordering)', async () => {
      respondWith(created);
      await runWebhookCreate({ url: 'https://example.com/hook', events: ['dsync.user.created'] });
      // Mutation: the resolver fetches the team's environments BEFORE the op.
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('createWebhookEndpoint');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: {
          endpointUrl: 'https://example.com/hook',
          environmentId: 'env_profile',
          events: ['dsync.user.created'],
        },
        environmentId: 'env_profile',
      });
      expect(consoleOutput.some((l) => l.includes('we_123'))).toBe(true);
    });

    it('says loudly that the signing secret is not returned (REST divergence)', async () => {
      respondWith(created);
      await runWebhookCreate({ url: 'https://example.com/hook', events: ['dsync.user.created'] });
      const out = consoleOutput.join('\n');
      expect(out).toContain('signing secret');
      expect(out).toContain('Dashboard');
    });

    it('--json emits { webhookEndpoint } echoing the inputs', async () => {
      setOutputMode('json');
      respondWith(created);
      await runWebhookCreate({ url: 'https://example.com/hook', events: ['a.b', 'c.d'] });
      const out = JSON.parse(consoleOutput[0]);
      expect(out).toEqual({
        webhookEndpoint: { id: 'we_123', url: 'https://example.com/hook', events: ['a.b', 'c.d'] },
      });
    });
  });

  describe('delete (destructive)', () => {
    const deleted = { deleteWebhookEndpoint: 'we_123' };

    it('refuses in agent mode without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runWebhookDelete('we_123', { yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('refuses in CI mode without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runWebhookDelete('we_123', {}), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactively with --yes, pre-validating the environment first', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      respondWith(deleted);
      await runWebhookDelete('we_123', { yes: true });
      expect(String(mockGraphqlRequest.mock.calls[0][0])).toContain('teamProjectsV2');
      expect(String(mockGraphqlRequest.mock.calls[1][0])).toContain('deleteWebhookEndpoint');
      expect(mockGraphqlRequest.mock.calls[1][1]).toEqual({
        token: 'tok_123',
        variables: { id: 'we_123' },
        environmentId: 'env_profile',
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      respondWith(deleted);
      await runWebhookDelete('we_123', { yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runWebhookDelete('we_123', { yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('--json emits { deleted }', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      setOutputMode('json');
      respondWith(deleted);
      await runWebhookDelete('we_123', { yes: true });
      expect(JSON.parse(consoleOutput[0])).toEqual({ deleted: 'we_123' });
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runWebhookList({}), 4);
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
      await expectExit(runWebhookList({}), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
