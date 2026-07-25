import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { EnvironmentConfig } from './config-store.js';

// Provenance is derived in-module from the config store, so the store is the
// only seam the tests need to drive. `isUnclaimedEnvironment` keeps its real
// (trivial) behavior so a fixture's `type` alone decides the branch.
const getActiveEnvironment = vi.fn<() => EnvironmentConfig | null>(() => null);

vi.mock('./config-store.js', () => ({
  getActiveEnvironment: () => getActiveEnvironment(),
  isUnclaimedEnvironment: (env: EnvironmentConfig) => env.type === 'unclaimed',
}));

vi.mock('../utils/analytics.js', () => ({
  analytics: { capture: vi.fn(), captureException: vi.fn() },
}));

const { analytics } = await import('../utils/analytics.js');
const ui = (await import('../utils/ui.js')).default;
const { autoConfigureWorkOSEnvironment } = await import('./workos-management.js');

const API_KEY = 'sk_test_123';
const HOMEPAGE_ENDPOINT = 'https://api.workos.com/user_management/app_homepage_url';
/** `autoConfigureWorkOSEnvironment(apiKey, integration, port)` — port drives every URL. */
const PORT = 4343;
const BASE_URL = `http://localhost:${PORT}`;

type FetchCall = { url: string; method: string };

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** A response whose body is not JSON — `.json()` rejects, like the real thing. */
function unparseableResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON');
    },
  } as unknown as Response;
}

/**
 * Stub `fetch` for the three parallel calls `autoConfigureWorkOSEnvironment`
 * makes. `homepage` decides what the newly added GET returns; the two POSTs
 * always succeed so failures can only come from the path under test.
 */
function stubFetch(homepage: (method: string) => Response | Promise<Response>): {
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const stub = vi.fn(async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    if (url === HOMEPAGE_ENDPOINT) return homepage(init.method);
    return jsonResponse(201, {});
  });
  vi.stubGlobal('fetch', stub);
  return { calls };
}

function homepageCalls(calls: FetchCall[], method: string): FetchCall[] {
  return calls.filter((c) => c.url === HOMEPAGE_ENDPOINT && c.method === method);
}

/** The rows array passed to the single `ui.rows` call. */
function capturedRows(): Array<{ key: string; value: string; status?: string; statusKind?: string }> {
  const spy = vi.mocked(ui.rows);
  expect(spy).toHaveBeenCalledTimes(1);
  return spy.mock.calls[0]![0];
}

function rowFor(key: string) {
  const row = capturedRows().find((r) => r.key === key);
  expect(row, `no "${key}" row was rendered`).toBeDefined();
  return row!;
}

const unclaimedEnv: EnvironmentConfig = {
  name: 'unclaimed-2',
  apiKey: API_KEY,
  type: 'unclaimed',
  clientId: 'client_123',
  claimToken: 'tok_123',
};

const claimedEnv: EnvironmentConfig = {
  name: 'sandbox',
  apiKey: API_KEY,
  type: 'sandbox',
};

/** `Integration` is a plain string identifier (constants.ts:8). */
const INTEGRATION = 'nextjs';

describe('workos-management', () => {
  beforeEach(() => {
    getActiveEnvironment.mockReset();
    getActiveEnvironment.mockReturnValue(null);
    vi.mocked(analytics.capture).mockClear();
    vi.spyOn(ui, 'rows').mockImplementation(() => {});
    vi.spyOn(ui.log, 'step').mockImplementation(() => {});
    vi.spyOn(ui.log, 'success').mockImplementation(() => {});
    vi.spyOn(ui.log, 'info').mockImplementation(() => {});
    vi.spyOn(ui.log, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('setHomepageUrl read-then-write', () => {
    it('skips the PUT when the current homepage URL already matches', async () => {
      const { calls } = stubFetch(() => jsonResponse(200, { url: BASE_URL }));

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'GET')).toHaveLength(1);
      expect(homepageCalls(calls, 'PUT')).toHaveLength(0);
      expect(result?.homepageUrl).toEqual({ success: true, alreadyExists: true });
      expect(rowFor('Homepage URL')).toMatchObject({ status: 'already set', statusKind: 'muted' });
    });

    it('issues the PUT when the current homepage URL differs', async () => {
      const { calls } = stubFetch((method) =>
        method === 'GET' ? jsonResponse(200, { url: 'https://app.example.com' }) : jsonResponse(200, {}),
      );

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
      expect(result?.homepageUrl).toEqual({ success: true, alreadyExists: false });
      expect(rowFor('Homepage URL')).toMatchObject({ value: BASE_URL, status: 'updated', statusKind: 'ok' });
    });

    it('compares against the caller-supplied homepage URL, not the base URL', async () => {
      const custom = 'https://staging.example.com';
      const { calls } = stubFetch(() => jsonResponse(200, { url: custom }));

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, { homepageUrl: custom });

      expect(homepageCalls(calls, 'PUT')).toHaveLength(0);
      expect(result?.homepageUrl.alreadyExists).toBe(true);
    });

    it.each([404, 500])('falls through to the PUT when the GET returns %i', async (status) => {
      const { calls } = stubFetch((method) =>
        method === 'GET' ? jsonResponse(status, { message: 'nope' }) : jsonResponse(200, {}),
      );

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
      expect(result?.homepageUrl.alreadyExists).toBe(false);
    });

    it('falls through to the PUT when the GET body is not JSON', async () => {
      const { calls } = stubFetch((method) => (method === 'GET' ? unparseableResponse(200) : jsonResponse(200, {})));

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
      expect(result?.homepageUrl.alreadyExists).toBe(false);
    });

    it('falls through to the PUT when the GET rejects', async () => {
      const { calls } = stubFetch((method) => {
        if (method === 'GET') return Promise.reject(new TypeError('fetch failed'));
        return jsonResponse(200, {});
      });

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
      expect(result?.homepageUrl.alreadyExists).toBe(false);
    });

    it('omits a request body on the GET so the read cannot be mistaken for a write', async () => {
      const bodies: Array<string | undefined> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: { method: string; body?: string }) => {
          if (url === HOMEPAGE_ENDPOINT && init.method === 'GET') bodies.push(init.body);
          return jsonResponse(200, { url: BASE_URL });
        }),
      );

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(bodies).toEqual([undefined]);
    });

    it('warns instead of aborting when the PUT fails', async () => {
      stubFetch((method) =>
        method === 'GET' ? jsonResponse(404, {}) : jsonResponse(403, { message: 'API key lacks permission' }),
      );

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(result).toBeNull();
      expect(ui.log.warn).toHaveBeenCalledWith(expect.stringContaining('Could not configure WorkOS dashboard'));
      expect(ui.rows).not.toHaveBeenCalled();
    });

    it('reports homepage no-op vs. overwrite to analytics', async () => {
      stubFetch(() => jsonResponse(200, { url: BASE_URL }));
      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);
      expect(analytics.capture).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ homepageUrl: 'existed' }),
      );

      vi.mocked(analytics.capture).mockClear();
      vi.mocked(ui.rows).mockClear();
      stubFetch((method) => (method === 'GET' ? jsonResponse(404, {}) : jsonResponse(200, {})));
      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);
      expect(analytics.capture).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ homepageUrl: 'updated' }),
      );
    });
  });

  describe('credential provenance row', () => {
    beforeEach(() => {
      stubFetch(() => jsonResponse(200, { url: BASE_URL }));
    });

    it('renders Environment as the first row', async () => {
      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(capturedRows()[0]?.key).toBe('Environment');
      expect(capturedRows().map((r) => r.key)).toEqual(['Environment', 'Redirect URI', 'CORS origin', 'Homepage URL']);
    });

    it('names an unclaimed environment and points at `env claim`', async () => {
      getActiveEnvironment.mockReturnValue(unclaimedEnv);

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      const value = rowFor('Environment').value;
      expect(value).toContain('unclaimed');
      expect(value).toContain('unclaimed-2');
      expect(value).toContain('env claim');
    });

    it('names a claimed active environment', async () => {
      getActiveEnvironment.mockReturnValue(claimedEnv);

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      const value = rowFor('Environment').value;
      expect(value).toBe('your active environment (sandbox)');
      expect(value).not.toContain('env claim');
    });

    it('falls back to the supplied-key wording with no active environment', async () => {
      getActiveEnvironment.mockReturnValue(null);

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(rowFor('Environment').value).toBe('the API key supplied to this run');
    });

    it('does not name a stored environment whose key did not do the writes', async () => {
      // `--api-key sk_live_prod...` bypasses the store: the writes landed in the
      // supplied key's environment, not the stored active one.
      getActiveEnvironment.mockReturnValue(unclaimedEnv);

      await autoConfigureWorkOSEnvironment('sk_live_prod_999', INTEGRATION, PORT);

      const value = rowFor('Environment').value;
      expect(value).toBe('the API key supplied to this run');
      expect(value).not.toContain('unclaimed-2');
      expect(value).not.toContain('env claim');
    });

    it('does not name a claimed stored environment whose key did not do the writes', async () => {
      getActiveEnvironment.mockReturnValue(claimedEnv);

      await autoConfigureWorkOSEnvironment('sk_live_prod_999', INTEGRATION, PORT);

      const value = rowFor('Environment').value;
      expect(value).toBe('the API key supplied to this run');
      expect(value).not.toContain('sandbox');
    });

    it('degrades to the supplied-key wording when the config store throws', async () => {
      getActiveEnvironment.mockImplementation(() => {
        throw new Error('keyring locked');
      });

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(result).not.toBeNull();
      expect(rowFor('Environment').value).toBe('the API key supplied to this run');
    });
  });
});
