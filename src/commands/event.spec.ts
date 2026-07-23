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
// store (session.spec.ts recipe).
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
const { runEventList } = await import('./event.js');

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

/** The authoritative curated event JSON shape (documented contract). */
const EVENT_SHAPE_KEYS = ['id', 'event', 'data', 'createdAt', 'updatedAt'];

const EVENT_NODE = {
  id: 'event_1',
  name: 'dsync.user.created',
  data: { directory_id: 'dir_1' },
  context: { actor: 'internal' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  metadata: {},
};

function eventsPayload(
  data: unknown[],
  listMetadata: { before: string | null; after: string | null } = { before: null, after: null },
) {
  return { environment: { events: { data, listMetadata } } };
}

describe('event command', () => {
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

  describe('list', () => {
    it('lists events with the environment threaded as variable AND header (read: no pre-validation fetch)', async () => {
      respondWith(eventsPayload([EVENT_NODE]));
      await runEventList({ events: ['dsync.user.created'] });
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentEvents'), {
        token: 'tok_123',
        variables: { environmentId: 'env_profile', names: ['dsync.user.created'] },
        environmentId: 'env_profile',
      });
      const out = consoleOutput.join('\n');
      expect(out).toContain('event_1');
      expect(out).toContain('dsync.user.created');
    });

    it('maps range and pagination flags to catalog variables (single-page default)', async () => {
      respondWith(eventsPayload([]));
      await runEventList({
        events: ['user.created', 'user.updated'],
        after: 'cursor_a',
        rangeStart: '2026-01-01',
        rangeEnd: '2026-02-01',
        limit: 5,
      });
      expect(mockGraphqlRequest).toHaveBeenCalledTimes(1);
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentEvents'), {
        token: 'tok_123',
        variables: {
          environmentId: 'env_profile',
          names: ['user.created', 'user.updated'],
          after: 'cursor_a',
          rangeStart: '2026-01-01',
          rangeEnd: '2026-02-01',
          limit: 5,
        },
        environmentId: 'env_profile',
      });
    });

    it('honors an --environment-id override', async () => {
      respondWith(eventsPayload([]));
      await runEventList({ events: ['user.created'], environmentId: 'env_flag' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('environmentEvents'), {
        token: 'tok_123',
        variables: { environmentId: 'env_flag', names: ['user.created'] },
        environmentId: 'env_flag',
      });
    });

    it('errors environment_not_found when the environment does not resolve', async () => {
      respondWith({ environment: null });
      const err = await expectExit(runEventList({ events: ['user.created'] }), 1);
      expect(err.context?.errorCode).toBe('environment_not_found');
    });

    it('handles empty results', async () => {
      respondWith(eventsPayload([]));
      await runEventList({ events: ['user.created'] });
      expect(consoleOutput.some((l) => l.includes('No events found'))).toBe(true);
    });

    it('--json emits the documented curated shape (drops internal context/metadata)', async () => {
      setOutputMode('json');
      respondWith(eventsPayload([EVENT_NODE], { before: null, after: 'cursor_a' }));
      await runEventList({ events: ['dsync.user.created'] });
      const raw = consoleOutput[0];
      expect(raw).not.toMatch(/graphql|userland|list_metadata/i);
      const out = JSON.parse(raw);
      expect(Object.keys(out)).toEqual(['events', 'pagination']);
      expect(Object.keys(out.events[0])).toEqual(EVENT_SHAPE_KEYS);
      expect(out.events[0]).toEqual({
        id: 'event_1',
        event: 'dsync.user.created',
        data: { directory_id: 'dir_1' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(out.pagination).toEqual({ before: null, after: 'cursor_a' });
    });

    it('renders pagination cursors in human mode', async () => {
      respondWith(eventsPayload([EVENT_NODE], { before: 'cursor_b', after: 'cursor_a' }));
      await runEventList({ events: ['dsync.user.created'] });
      expect(consoleOutput.some((l) => l.includes('Before: cursor_b') && l.includes('After: cursor_a'))).toBe(true);
    });
  });

  describe('shared failure modes', () => {
    it('exits auth-required (code 4) when not logged in', async () => {
      mockRequireCommandToken.mockImplementation(() => {
        throw new CliExit(4, { reason: 'auth_required', errorCode: 'auth_required' });
      });
      await expectExit(runEventList({ events: ['user.created'] }), 4);
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
      await expectExit(runEventList({ events: ['user.created'] }), 1);
      const err = consoleErrors.join('\n');
      expect(err).toMatch(/account-plane capability/i);
      expect(err).not.toMatch(/graphql/i);
    });
  });
});
