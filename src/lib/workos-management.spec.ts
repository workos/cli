import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setInteractionMode, resetInteractionModeForTests } from '../utils/interaction-mode.js';
import { setOutputMode } from '../utils/output.js';
import { ensureAuthenticated } from './ensure-auth.js';
import { getAccessToken } from './credentials.js';
import { fetchStagingCredentials } from './staging-api.js';
import type { EnvironmentConfig } from './config-store.js';

// Provenance is derived in-module from the config store, so the store is the
// only seam the tests need to drive. `isUnclaimedEnvironment` keeps its real
// (trivial) behavior so a fixture's `type` alone decides the branch.
const getActiveEnvironment = vi.fn<() => EnvironmentConfig | null>(() => null);

vi.mock('./config-store.js', () => ({
  getActiveEnvironment: () => getActiveEnvironment(),
  isUnclaimedEnvironment: (env: EnvironmentConfig) => env.type === 'unclaimed',
}));

vi.mock('./ensure-auth.js', () => ({ ensureAuthenticated: vi.fn() }));
vi.mock('./credentials.js', () => ({ getAccessToken: vi.fn() }));
vi.mock('./staging-api.js', () => ({ fetchStagingCredentials: vi.fn() }));

vi.mock('../utils/analytics.js', () => ({
  analytics: { capture: vi.fn(), captureException: vi.fn() },
}));

const { analytics } = await import('../utils/analytics.js');
const { default: ui, CANCEL } = await import('../utils/ui.js');
const { autoConfigureWorkOSEnvironment, SANDBOX_ONLY_REASON } = await import('./workos-management.js');

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
    if (url.endsWith('/claim-nonces')) return Response.json({ nonce: 'claim_nonce' });
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

  describe('bounded Unauthorized recovery', () => {
    const pair = { apiKey: 'sk_test_fake_recovered', clientId: 'client_fake' };
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    beforeEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
      setInteractionMode({ mode: 'human', source: 'flag' });
      setOutputMode('human');
      vi.spyOn(ui, 'select').mockResolvedValue('retry');
      vi.mocked(ensureAuthenticated)
        .mockReset()
        .mockResolvedValue({ authenticated: true, loginTriggered: false, tokenRefreshed: false });
      vi.mocked(getAccessToken).mockReset().mockReturnValue('fake-token');
      vi.mocked(fetchStagingCredentials).mockReset().mockResolvedValue(pair);
    });
    afterEach(() => {
      if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
      resetInteractionModeForTests();
      setOutputMode('human');
    });

    it.each([
      [
        { authenticated: true, loginTriggered: false, tokenRefreshed: false },
        'Using the existing dashboard session; no new login was needed.',
      ],
      [{ authenticated: true, loginTriggered: false, tokenRefreshed: true }, 'Dashboard session refreshed.'],
      [{ authenticated: true, loginTriggered: true, tokenRefreshed: false }, 'Signed in to WorkOS.'],
    ] as const)('recovers with a same-target pair and truthful auth wording: %s', async (auth, message) => {
      vi.mocked(ensureAuthenticated).mockResolvedValue(auth);
      const fetch = vi.fn(async (_url: string, init: RequestInit) =>
        Response.json(
          {},
          {
            status: (init.headers as Record<string, string>).Authorization === `Bearer ${API_KEY}` ? 401 : 201,
          },
        ),
      );
      vi.stubGlobal('fetch', fetch);
      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, { clientId: pair.clientId });
      expect(result?.recoveredCredentials).toEqual(pair);
      expect(fetch).toHaveBeenCalledTimes(4);
      expect(ui.select).toHaveBeenCalledTimes(1);
      expect(ui.log.info).toHaveBeenCalledWith(message);
      expect(JSON.stringify(vi.mocked(analytics.capture).mock.calls)).not.toContain(pair.apiKey);
    });

    it.each(['same', 'mismatch', 'production', 'noClient', 'manual', 'cancel', 'exhausted'])(
      'stops without adopting a replacement: %s',
      async (failure) => {
        const fetch = vi.fn(async () => Response.json({ message: 'fake_secret_backend' }, { status: 401 }));
        vi.stubGlobal('fetch', fetch);
        if (failure === 'same') vi.mocked(fetchStagingCredentials).mockResolvedValue({ ...pair, apiKey: API_KEY });
        if (failure === 'mismatch')
          vi.mocked(fetchStagingCredentials).mockResolvedValue({ ...pair, clientId: 'client_other' });
        if (failure === 'production')
          vi.mocked(fetchStagingCredentials).mockResolvedValue({ ...pair, apiKey: 'sk_live_fake' });
        if (failure === 'manual') vi.mocked(ui.select).mockResolvedValue('manual');
        if (failure === 'cancel') vi.mocked(ui.select).mockResolvedValue(CANCEL);
        expect(
          await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, {
            clientId: failure === 'noClient' ? undefined : pair.clientId,
          }),
        ).toBeNull();
        expect(ui.select).toHaveBeenCalledTimes(1);
        expect(fetch).toHaveBeenCalledTimes(failure === 'exhausted' ? 4 : 2);
        expect(ui.log.success).not.toHaveBeenCalled();
        const output = JSON.stringify([
          vi.mocked(ui.log.warn).mock.calls,
          vi.mocked(ui.log.info).mock.calls,
          vi.mocked(analytics.capture).mock.calls,
        ]);
        expect(output).not.toContain('fake_secret_backend');
        expect(output).not.toContain(pair.apiKey);
        expect(ui.rows).toHaveBeenCalledWith(
          expect.arrayContaining([{ key: 'Redirect URI', value: `${BASE_URL}/auth/callback` }]),
        );
      },
    );

    it.each([403, 422, 500])(
      'does not offer auth recovery for HTTP %s even with Unauthorized in the body',
      async (status) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json({ message: 'Unauthorized 401 fake_secret_backend' }, { status })),
        );
        expect(
          await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, { clientId: pair.clientId }),
        ).toBeNull();
        expect(ui.select).not.toHaveBeenCalled();
        expect(ensureAuthenticated).not.toHaveBeenCalled();
        expect(JSON.stringify(vi.mocked(analytics.capture).mock.calls)).not.toContain('fake_secret_backend');
      },
    );

    it('waits for in-flight writes and does not disguise concurrent non-auth failure as a 401', async () => {
      let settle!: (response: Response) => void;
      const slow = new Promise<Response>((resolve) => {
        settle = resolve;
      });
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(Response.json({}, { status: 401 }))
          .mockReturnValueOnce(slow),
      );
      const result = autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, { clientId: pair.clientId });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(ui.select).not.toHaveBeenCalled();
      settle(Response.json({}, { status: 403 }));
      expect(await result).toBeNull();
      expect(ui.select).not.toHaveBeenCalled();
    });

    it.each([undefined, 'https://requested.example/'])(
      'preserves default-vs-explicit homepage semantics after replacing an unclaimed profile key (%s)',
      async (homepageUrl) => {
        const profile: EnvironmentConfig = { ...unclaimedEnv, clientId: pair.clientId };
        getActiveEnvironment.mockReturnValue(profile);
        let homepage = 'https://existing.example/';
        const calls: FetchCall[] = [];
        const request = vi.fn(async (url: string, init: RequestInit) => {
          calls.push({ url, method: init.method! });
          if (url.endsWith('/claim-nonces')) return Response.json({ nonce: 'fake_claim_nonce' });
          const rejected = (init.headers as Record<string, string>).Authorization === `Bearer ${API_KEY}`;
          if (rejected) return Response.json({}, { status: 401 });
          if (url === HOMEPAGE_ENDPOINT) {
            if (init.method === 'GET') return Response.json({ url: homepage });
            homepage = JSON.parse(init.body as string).url;
          }
          return Response.json({}, { status: 201 });
        });
        vi.stubGlobal('fetch', request);

        const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, {
          clientId: pair.clientId,
          homepageUrl,
        });
        expect(result?.recoveredCredentials).toEqual(pair);
        expect(result?.redirectUri.success).toBe(true);
        expect(result?.corsOrigin.success).toBe(true);
        expect(profile.apiKey).toBe(API_KEY);
        expect(ui.select).toHaveBeenCalledTimes(1);
        if (homepageUrl) {
          expect(result?.homepageUrl).toEqual({ success: true, alreadyExists: false });
          expect(homepage).toBe(homepageUrl);
          expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
          expect(ui.log.success).toHaveBeenCalledWith('WorkOS dashboard configured');
        } else {
          // A same-client staging pair does not transfer the old claim token's
          // ownership or prove the environment is STILL unclaimed after login.
          expect(result?.homepageUrl).toBeUndefined();
          expect(homepage).toBe('https://existing.example/');
          expect(homepageCalls(calls, 'PUT')).toHaveLength(0);
          expect(calls.filter(({ url }) => url.endsWith('/claim-nonces'))).toHaveLength(1);
          expect(ui.log.success).not.toHaveBeenCalled();
          expect(ui.log.warn).toHaveBeenCalledWith(expect.stringContaining('homepage left unchanged'));
          expect(rowFor('Homepage URL').status).toContain('not changed');
        }
      },
    );

    it('never writes the homepage after its GET rejects authorization', async () => {
      const request = vi.fn(async (url: string) =>
        Response.json({}, { status: url === HOMEPAGE_ENDPOINT ? 401 : 201 }),
      );
      vi.stubGlobal('fetch', request);
      vi.mocked(ui.select).mockResolvedValue('manual');
      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, {
        homepageUrl: BASE_URL,
        clientId: pair.clientId,
      });
      expect(request.mock.calls).toHaveLength(3);
      expect(ui.select).toHaveBeenCalledTimes(1);
    });
  });

  describe('setHomepageUrl read-then-write', () => {
    // The homepage is only written where nothing can be overwritten; an
    // unclaimed environment is one (see 'homepage without a user choice').
    beforeEach(() => {
      getActiveEnvironment.mockReturnValue(unclaimedEnv);
    });

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
          if (url.endsWith('/claim-nonces')) return Response.json({ nonce: 'claim_nonce' });
          if (url === HOMEPAGE_ENDPOINT && init.method === 'GET') bodies.push(init.body);
          return jsonResponse(200, { url: BASE_URL });
        }),
      );

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(bodies).toEqual([undefined]);
    });

    it('declares Content-Type only on the requests that carry a body', async () => {
      const seen: Array<{ method: string; contentType?: string }> = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, init: { method: string; headers: Record<string, string> }) => {
          if (url.endsWith('/claim-nonces')) return Response.json({ nonce: 'claim_nonce' });
          if (url === HOMEPAGE_ENDPOINT) {
            seen.push({ method: init.method, contentType: init.headers['Content-Type'] });
          }
          // Differing URL forces the PUT, so both methods are observed.
          return jsonResponse(200, { url: 'https://app.example.com' });
        }),
      );

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(seen).toEqual([
        { method: 'GET', contentType: undefined },
        { method: 'PUT', contentType: 'application/json' },
      ]);
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
      expect(value).toContain('profile claim');
    });

    it('names a claimed active environment', async () => {
      getActiveEnvironment.mockReturnValue(claimedEnv);

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      const value = rowFor('Environment').value;
      expect(value).toBe('your active environment (sandbox)');
      expect(value).not.toContain('profile claim');
    });

    it('falls back to the supplied-key wording with no active environment', async () => {
      getActiveEnvironment.mockReturnValue(null);

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(rowFor('Environment').value).toBe('the API key supplied to this run');
    });

    it('does not name a stored environment whose key did not do the writes', async () => {
      // `--api-key sk_test_other...` bypasses the store: the writes landed in the
      // supplied key's environment, not the stored active one.
      getActiveEnvironment.mockReturnValue(unclaimedEnv);

      await autoConfigureWorkOSEnvironment('sk_test_other_999', INTEGRATION, PORT);

      const value = rowFor('Environment').value;
      expect(value).toBe('the API key supplied to this run');
      expect(value).not.toContain('unclaimed-2');
      expect(value).not.toContain('profile claim');
    });

    it('does not name a claimed stored environment whose key did not do the writes', async () => {
      getActiveEnvironment.mockReturnValue(claimedEnv);

      await autoConfigureWorkOSEnvironment('sk_test_other_999', INTEGRATION, PORT);

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

  describe('homepage without a user choice', () => {
    it('leaves the homepage of a claimed environment alone and says so', async () => {
      getActiveEnvironment.mockReturnValue(claimedEnv);
      const { calls } = stubFetch(() => jsonResponse(404, {}));

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'GET')).toHaveLength(0);
      expect(homepageCalls(calls, 'PUT')).toHaveLength(0);
      expect(result).not.toBeNull();
      expect(result?.homepageUrl).toBeUndefined();
      expect(rowFor('Homepage URL')).toMatchObject({ value: BASE_URL, statusKind: 'warn' });
      expect(analytics.capture).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ homepageUrl: 'skipped' }),
      );
    });

    it.each([
      ['no stored environment', () => null],
      ['another environment’s unclaimed key', () => ({ ...unclaimedEnv, apiKey: 'sk_test_other' })],
      [
        'an unreadable keyring',
        () => {
          throw new Error('keyring locked');
        },
      ],
    ])('leaves it alone with %s', async (_, active) => {
      getActiveEnvironment.mockImplementation(active as () => EnvironmentConfig | null);
      const { calls } = stubFetch(() => jsonResponse(404, {}));

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'PUT')).toHaveLength(0);
    });

    it.each([
      ['claimed elsewhere', () => Response.json({ already_claimed: true })],
      ['claim conflict', () => new Response(null, { status: 409 })],
      ['unavailable claim status', () => new Response(null, { status: 500 })],
    ] as const)('preserves the homepage for a locally unclaimed profile with %s', async (_, claim) => {
      getActiveEnvironment.mockReturnValue(unclaimedEnv);
      const request = vi.fn(async (url: string) => (url.endsWith('/claim-nonces') ? claim() : Response.json({})));
      vi.stubGlobal('fetch', request);

      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(result).not.toBeNull();
      expect(result?.redirectUri.success).toBe(true);
      expect(result?.corsOrigin.success).toBe(true);
      expect(result?.homepageUrl).toBeUndefined();
      expect(request.mock.calls.some(([url]) => url === HOMEPAGE_ENDPOINT)).toBe(false);
      expect(rowFor('Homepage URL')).toMatchObject({ status: 'not changed; check the dashboard' });
    });

    it('sets it after confirming the stored environment is still unclaimed', async () => {
      getActiveEnvironment.mockReturnValue(unclaimedEnv);
      const { calls } = stubFetch((method) => (method === 'GET' ? jsonResponse(404, {}) : jsonResponse(200, {})));

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT);

      expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
      expect(calls.findIndex(({ url }) => url.endsWith('/claim-nonces'))).toBeLessThan(
        calls.findIndex(({ url, method }) => url === HOMEPAGE_ENDPOINT && method === 'PUT'),
      );
    });

    it('sets the homepage the user asked for (--homepage-url) on any environment', async () => {
      getActiveEnvironment.mockReturnValue(claimedEnv);
      const { calls } = stubFetch((method) => (method === 'GET' ? jsonResponse(404, {}) : jsonResponse(200, {})));

      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, { homepageUrl: 'https://app.example.com' });

      expect(homepageCalls(calls, 'PUT')).toHaveLength(1);
      expect(calls.some(({ url }) => url.endsWith('/claim-nonces'))).toBe(false);
    });
  });

  describe('production keys', () => {
    it.each([
      ['a live key', 'sk_live_prod_999'],
      ['an unrecognized key', 'sk_prod_999'],
    ])('writes nothing with %s and reports each item as skipped', async (_, apiKey) => {
      const { calls } = stubFetch(() => jsonResponse(200, {}));
      const steps: string[] = [];

      const result = await autoConfigureWorkOSEnvironment(apiKey, INTEGRATION, PORT, {
        onStep: (step, status, detail) => steps.push(`${step}:${status}:${detail}`),
      });

      expect(result).toBeNull();
      expect(calls).toEqual([]);
      expect(steps).toEqual([
        `redirect-uri:skipped:${SANDBOX_ONLY_REASON}`,
        `cors-origin:skipped:${SANDBOX_ONLY_REASON}`,
      ]);
      expect(ui.log.warn).toHaveBeenCalledWith(SANDBOX_ONLY_REASON);
      expect(ui.rows).not.toHaveBeenCalled();
    });

    it('writes nothing with a live key even when it is the active profile', async () => {
      getActiveEnvironment.mockReturnValue({ name: 'production', type: 'production', apiKey: 'sk_live_active' });
      const { calls } = stubFetch(() => jsonResponse(200, {}));

      await autoConfigureWorkOSEnvironment('sk_live_active', INTEGRATION, PORT);

      expect(calls).toEqual([]);
    });
  });

  describe('checklist reporting', () => {
    it('reports each item as it resolves', async () => {
      stubFetch(() => jsonResponse(200, { url: 'http://elsewhere' }));
      const steps: string[] = [];
      await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, {
        onStep: (step, status) => steps.push(`${step}:${status}`),
      });
      expect(steps).toEqual(['redirect-uri:started', 'cors-origin:started', 'redirect-uri:done', 'cors-origin:done']);
    });

    it('reports a failed write with its error and keeps the existing failure handling', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => jsonResponse(500, { message: 'boom' })),
      );
      const steps: string[] = [];
      const result = await autoConfigureWorkOSEnvironment(API_KEY, INTEGRATION, PORT, {
        onStep: (step, status) => steps.push(`${step}:${status}`),
      });
      expect(result).toBeNull();
      expect(steps).toContain('redirect-uri:failed');
      expect(steps).toContain('cors-origin:failed');
    });
  });
});
