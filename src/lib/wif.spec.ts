import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Stored profile for the credential-order tests; undefined = no profile.
let activeEnv: { name: string; type: 'production' | 'sandbox'; apiKey: string } | undefined;
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: () => activeEnv,
}));

const {
  getWifAccessToken,
  getWifState,
  isWifAccessToken,
  resetWifCacheForTests,
  WIF_GRANT_TYPE,
  ENVIRONMENT_ID_HEADER,
} = await import('./wif.js');
const { resolveApiKey, resolveApiKeyAsync, resolveOptionalApiKey, primeApiCredentials } = await import('./api-key.js');
const { apiRequest } = await import('../commands/api/request.js');
const { workosRequest } = await import('./workos-api.js');
const { createWorkOSClient } = await import('./workos-client.js');
const { runVerifyLogin } = await import('../commands/verify-login.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { setOutputMode } = await import('../utils/output.js');
const { sanitizeMessage, sanitizeStack } = await import('../utils/crash-reporter.js');
const { redactCredentials } = await import('../utils/redact.js');

// Distinctive values so any leak is easy to spot.
const GITHUB_JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJyZXBvIjoiYWNtZS9hcHAifQ.github-jwt-signature-SECRET';
const ACCESS_TOKEN = 'wos_m2m_access_token_SECRET_0001';
const ACCESS_TOKEN_2 = 'wos_m2m_access_token_SECRET_0002';
const REQUEST_TOKEN = 'actions-runtime-request-token-SECRET';

const ID_TOKEN_REQUEST_URL = 'https://pipelines.actions.githubusercontent.com/abc123/idtoken?api-version=2.0';
const TOKEN_URL = 'https://auth.example.com/oauth2/token';
const API_BASE = 'https://api.workos.com';

type Handler = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function headersOf(call: FetchCall): Headers {
  return new Headers(call.init?.headers);
}

let calls: FetchCall[];
let githubHandler: Handler;
let tokenHandler: Handler;
let apiHandler: Handler;
let accessTokens: string[];

function githubCalls(): FetchCall[] {
  return calls.filter((c) => c.url.startsWith('https://pipelines.actions.githubusercontent.com/'));
}
function tokenCalls(): FetchCall[] {
  return calls.filter((c) => c.url === TOKEN_URL);
}
function apiCalls(): FetchCall[] {
  return calls.filter((c) => c.url.startsWith(API_BASE));
}

/** Await a promise expected to reject with CliExit; return it with the structured error that was printed. */
async function expectCliExit(promise: Promise<unknown>): Promise<InstanceType<typeof CliExit>> {
  const error = await promise.then(
    () => {
      throw new Error('expected a CliExit');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CliExit);
  return error as InstanceType<typeof CliExit>;
}

let stderr: string[];
let stdout: string[];

describe('workload identity federation (wif)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.WORKOS_API_KEY;
    delete process.env.WORKOS_API_URL;
    delete process.env.WORKOS_API_BASE_URL;
    delete process.env.WORKOS_WIF_AUDIENCE;
    delete process.env.WORKOS_WIF_SCOPE;
    delete process.env.WORKOS_ENVIRONMENT_ID;
    process.env.GITHUB_ACTIONS = 'true';
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = ID_TOKEN_REQUEST_URL;
    process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = REQUEST_TOKEN;
    process.env.WORKOS_CLIENT_ID = 'client_m2m_123';
    process.env.WORKOS_WIF_TOKEN_URL = TOKEN_URL;

    activeEnv = undefined;
    resetWifCacheForTests();
    setOutputMode('human');

    calls = [];
    accessTokens = [ACCESS_TOKEN, ACCESS_TOKEN_2];
    githubHandler = () => json({ value: GITHUB_JWT });
    tokenHandler = () => json({ access_token: accessTokens.shift(), token_type: 'Bearer', expires_in: 300 });
    apiHandler = () => json({ data: [], list_metadata: { before: null, after: null } });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      calls.push({ url, init });
      if (url.startsWith('https://pipelines.actions.githubusercontent.com/')) return githubHandler(url, init);
      if (url === TOKEN_URL) return tokenHandler(url, init);
      return apiHandler(url, init);
    });

    stderr = [];
    stdout = [];
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderr.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      stdout.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('credential order', () => {
    it('WORKOS_API_KEY wins: used exactly as today, with no WIF exchange', async () => {
      process.env.WORKOS_API_KEY = 'sk_test_env_key';
      activeEnv = { name: 'prod', type: 'production', apiKey: 'sk_test_stored' };

      expect(await resolveApiKeyAsync()).toBe('sk_test_env_key');
      expect(resolveApiKey()).toBe('sk_test_env_key');
      expect(calls).toHaveLength(0);
    });

    it('--api-key wins over WIF too', async () => {
      expect(await resolveApiKeyAsync({ apiKey: 'sk_test_flag' })).toBe('sk_test_flag');
      expect(calls).toHaveLength(0);
    });

    it('uses WIF next, ahead of a stored profile key', async () => {
      activeEnv = { name: 'prod', type: 'production', apiKey: 'sk_test_stored' };

      expect(await resolveApiKeyAsync()).toBe(ACCESS_TOKEN);
      expect(resolveApiKey()).toBe(ACCESS_TOKEN);
      expect(githubCalls()).toHaveLength(1);
      expect(tokenCalls()).toHaveLength(1);
      expect(isWifAccessToken(ACCESS_TOKEN)).toBe(true);
    });

    it('falls back to the stored profile key outside GitHub Actions', async () => {
      delete process.env.GITHUB_ACTIONS;
      activeEnv = { name: 'prod', type: 'production', apiKey: 'sk_test_stored' };

      expect(getWifState()).toBe('off');
      expect(await resolveApiKeyAsync()).toBe('sk_test_stored');
      expect(calls).toHaveLength(0);
    });

    it('falls back to the stored profile key when WORKOS_CLIENT_ID is unset', async () => {
      delete process.env.WORKOS_CLIENT_ID;
      activeEnv = { name: 'prod', type: 'production', apiKey: 'sk_test_stored' };

      expect(getWifState()).toBe('off');
      expect(await resolveApiKeyAsync()).toBe('sk_test_stored');
      expect(calls).toHaveLength(0);
    });

    it("keeps today's no_api_key error when nothing is configured and WIF doesn't apply", async () => {
      delete process.env.GITHUB_ACTIONS;

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('no_api_key');
      expect(exit.exitCode).toBe(4);
      expect(stderr.join('\n')).toContain('No API key configured');
      expect(calls).toHaveLength(0);
    });

    it('requires GITHUB_ACTIONS to be exactly "true"', () => {
      process.env.GITHUB_ACTIONS = '1';
      expect(getWifState()).toBe('off');
    });

    it('uses a stored profile key as today when the Actions OIDC variables are missing', async () => {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
      activeEnv = { name: 'ci', type: 'sandbox', apiKey: 'sk_test_stored' };

      expect(getWifState()).toBe('missing_id_token_env');
      expect(await resolveApiKeyAsync()).toBe('sk_test_stored');
      expect(calls).toHaveLength(0);
    });

    it('resolveOptionalApiKey (workos migrations) never uses WIF', async () => {
      expect(resolveOptionalApiKey()).toBeUndefined();
      activeEnv = { name: 'ci', type: 'sandbox', apiKey: 'sk_test_stored' };
      expect(resolveOptionalApiKey()).toBe('sk_test_stored');
      expect(calls).toHaveLength(0);
    });

    it('primeApiCredentials is a no-op when an API key is set', async () => {
      await primeApiCredentials({ apiKey: 'sk_test_flag' });
      process.env.WORKOS_API_KEY = 'sk_test_env_key';
      await primeApiCredentials();
      expect(calls).toHaveLength(0);
    });

    it('a synchronous caller that was never primed exits instead of falling back', async () => {
      activeEnv = { name: 'ci', type: 'sandbox', apiKey: 'sk_test_stored' };

      const exit = await expectCliExit(Promise.resolve().then(() => resolveApiKey()));
      expect(exit.context?.errorCode).toBe('wif_unsupported_command');
      expect(stderr.join('\n')).toContain('Set WORKOS_API_KEY');
    });
  });

  describe('GitHub OIDC token request', () => {
    it('requests the default audience with the Actions request token', async () => {
      await getWifAccessToken();

      const [call] = githubCalls();
      const url = new URL(call!.url);
      expect(url.origin + url.pathname).toBe('https://pipelines.actions.githubusercontent.com/abc123/idtoken');
      expect(url.searchParams.get('api-version')).toBe('2.0');
      expect(url.searchParams.get('audience')).toBe('https://api.workos.com');
      expect(call!.init?.method).toBe('GET');
      expect(headersOf(call!).get('authorization')).toBe(`Bearer ${REQUEST_TOKEN}`);
    });

    it('WORKOS_WIF_AUDIENCE overrides the audience, URL-encoded as a proper parameter', async () => {
      process.env.WORKOS_WIF_AUDIENCE = 'https://custom.example.com/aud?x=1&y=2';
      await getWifAccessToken();

      const url = new URL(githubCalls()[0]!.url);
      expect(url.searchParams.get('audience')).toBe('https://custom.example.com/aud?x=1&y=2');
      expect(url.searchParams.get('api-version')).toBe('2.0');
      expect(url.searchParams.getAll('audience')).toHaveLength(1);
    });
  });

  describe('token exchange', () => {
    it('posts exactly the jwt-bearer form fields, without scope by default', async () => {
      await getWifAccessToken();

      const [call] = tokenCalls();
      expect(call!.init?.method).toBe('POST');
      expect(headersOf(call!).get('content-type')).toBe('application/x-www-form-urlencoded');
      const form = new URLSearchParams(String(call!.init?.body));
      expect(Object.fromEntries(form)).toEqual({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: GITHUB_JWT,
        client_id: 'client_m2m_123',
        resource: 'https://api.workos.com',
      });
      expect(WIF_GRANT_TYPE).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    });

    it('adds scope only when WORKOS_WIF_SCOPE is set', async () => {
      process.env.WORKOS_WIF_SCOPE = 'organizations:read organizations:write';
      await getWifAccessToken();

      const form = new URLSearchParams(String(tokenCalls()[0]!.init?.body));
      expect(form.get('scope')).toBe('organizations:read organizations:write');
      expect([...form.keys()].sort()).toEqual(['assertion', 'client_id', 'grant_type', 'resource', 'scope']);
    });
  });

  describe('API calls', () => {
    it('sends the access token and x-url-environment-id when WORKOS_ENVIRONMENT_ID is set', async () => {
      process.env.WORKOS_ENVIRONMENT_ID = 'environment_01ABC';

      await apiRequest({ method: 'GET', path: '/organizations', baseUrl: API_BASE });

      const headers = headersOf(apiCalls()[0]!);
      expect(headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(headers.get(ENVIRONMENT_ID_HEADER)).toBe('environment_01ABC');
    });

    it('omits x-url-environment-id when WORKOS_ENVIRONMENT_ID is unset', async () => {
      await apiRequest({ method: 'GET', path: '/organizations', baseUrl: API_BASE });

      const headers = headersOf(apiCalls()[0]!);
      expect(headers.get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(headers.has(ENVIRONMENT_ID_HEADER)).toBe(false);
    });

    it('never adds x-url-environment-id to an API key request', async () => {
      process.env.WORKOS_API_KEY = 'sk_test_env_key';
      process.env.WORKOS_ENVIRONMENT_ID = 'environment_01ABC';

      await apiRequest({ method: 'GET', path: '/organizations', baseUrl: API_BASE });

      const headers = headersOf(apiCalls()[0]!);
      expect(headers.get('authorization')).toBe('Bearer sk_test_env_key');
      expect(headers.has(ENVIRONMENT_ID_HEADER)).toBe(false);
      expect(tokenCalls()).toHaveLength(0);
    });

    it('workosRequest and the SDK client both send the WIF headers', async () => {
      process.env.WORKOS_ENVIRONMENT_ID = 'environment_01ABC';
      const token = await resolveApiKeyAsync();

      await workosRequest({ method: 'GET', path: '/audit_logs/actions', apiKey: token, baseUrl: API_BASE });
      await createWorkOSClient(token, API_BASE).sdk.organizations.listOrganizations();

      const sent = apiCalls();
      expect(sent).toHaveLength(2);
      for (const call of sent) {
        expect(headersOf(call).get('authorization')).toBe(`Bearer ${ACCESS_TOKEN}`);
        expect(headersOf(call).get(ENVIRONMENT_ID_HEADER)).toBe('environment_01ABC');
      }
    });
  });

  describe('caching', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    });

    it('does not exchange again while the token is fresh', async () => {
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN);
      vi.advanceTimersByTime(200_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN);
      expect(await resolveApiKeyAsync()).toBe(ACCESS_TOKEN);

      expect(githubCalls()).toHaveLength(1);
      expect(tokenCalls()).toHaveLength(1);
    });

    it('exchanges again once less than 60 s is left of a 300 s token', async () => {
      await getWifAccessToken();
      vi.advanceTimersByTime(239_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN);
      vi.advanceTimersByTime(2_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN_2);

      expect(githubCalls()).toHaveLength(2);
      expect(tokenCalls()).toHaveLength(2);
    });

    it('uses 20% of the lifetime when that margin is smaller than 60 s', async () => {
      tokenHandler = () => json({ access_token: accessTokens.shift(), token_type: 'Bearer', expires_in: 100 });

      await getWifAccessToken();
      vi.advanceTimersByTime(79_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN);
      vi.advanceTimersByTime(2_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN_2);
    });

    it('uses 60 s, not 20%, for a 600 s token', async () => {
      tokenHandler = () => json({ access_token: accessTokens.shift(), token_type: 'Bearer', expires_in: 600 });

      await getWifAccessToken();
      vi.advanceTimersByTime(539_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN);
      vi.advanceTimersByTime(2_000);
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN_2);
    });

    it('a request holding an old token sends a refreshed one, never the expiring one', async () => {
      const token = await resolveApiKeyAsync();
      vi.advanceTimersByTime(290_000);

      await apiRequest({ method: 'GET', path: '/organizations', apiKey: token, baseUrl: API_BASE });
      await createWorkOSClient(token, API_BASE).sdk.organizations.listOrganizations();

      for (const call of apiCalls()) {
        expect(headersOf(call).get('authorization')).toBe(`Bearer ${ACCESS_TOKEN_2}`);
      }
      expect(tokenCalls()).toHaveLength(2);
    });

    it('concurrent callers share one in-flight exchange', async () => {
      const tokens = await Promise.all([
        getWifAccessToken(),
        getWifAccessToken(),
        resolveApiKeyAsync(),
        primeApiCredentials().then(() => resolveApiKey()),
        apiRequest({ method: 'GET', path: '/organizations', baseUrl: API_BASE }).then(() => ACCESS_TOKEN),
      ]);

      expect(new Set(tokens)).toEqual(new Set([ACCESS_TOKEN]));
      expect(githubCalls()).toHaveLength(1);
      expect(tokenCalls()).toHaveLength(1);
    });

    it('does not cache a failed exchange', async () => {
      tokenHandler = () => new Response('upstream down', { status: 503 });
      await expectCliExit(getWifAccessToken());

      tokenHandler = () => json({ access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 300 });
      expect(await getWifAccessToken()).toBe(ACCESS_TOKEN);
      expect(tokenCalls()).toHaveLength(2);
    });
  });

  describe('errors', () => {
    it('missing Actions OIDC variables with no other credential: tells the user to add id-token: write', async () => {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_id_token_unavailable');
      expect(exit.exitCode).toBe(4);
      expect(stderr.join('\n')).toContain('permissions: id-token: write');
      expect(calls).toHaveLength(0);
    });

    it.each([401, 403])('GitHub OIDC request %i: tells the user to add id-token: write', async (status) => {
      githubHandler = () => json({ message: 'Unauthorized' }, status);

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_id_token_unavailable');
      expect(exit.exitCode).toBe(4);
      expect(stderr.join('\n')).toContain('permissions: id-token: write');
      expect(stderr.join('\n')).toContain(`HTTP ${status}`);
      expect(tokenCalls()).toHaveLength(0);
    });

    it('GitHub OIDC request 500: generic message with the status', async () => {
      githubHandler = () => new Response('oops', { status: 500 });

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_id_token_request_failed');
      expect(exit.exitCode).toBe(1);
      expect(stderr.join('\n')).toContain('HTTP 500');
    });

    it('GitHub OIDC response without a token value', async () => {
      githubHandler = () => json({ count: 0 });

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_id_token_request_failed');
      expect(stderr.join('\n')).toContain('had no token (HTTP 200)');
    });

    it('missing WORKOS_WIF_TOKEN_URL: says it is required, why, and its shape, with no fallback', async () => {
      delete process.env.WORKOS_WIF_TOKEN_URL;
      activeEnv = { name: 'ci', type: 'sandbox', apiKey: 'sk_test_stored' };

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_token_url_missing');
      expect(exit.exitCode).toBe(4);
      const message = stderr.join('\n');
      expect(message).toContain('WORKOS_WIF_TOKEN_URL is required');
      expect(message).toContain('still being built');
      expect(message).toContain('https://<your AuthKit domain>/oauth2/token');
      expect(calls).toHaveLength(0);
    });

    it('rejects a plain-http WORKOS_WIF_TOKEN_URL that is not localhost', async () => {
      process.env.WORKOS_WIF_TOKEN_URL = 'http://auth.example.com/oauth2/token';

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_token_url_invalid');
      expect(calls).toHaveLength(0);
    });

    it.each([
      ['invalid_grant', 'trust rules'],
      ['invalid_target', 'audience'],
      ['invalid_client', 'WORKOS_CLIENT_ID'],
      ['invalid_scope', 'WORKOS_WIF_SCOPE'],
      ['invalid_request', '/oauth2/token'],
    ])('%s: names the error, includes error_description and a hint', async (error, hint) => {
      tokenHandler = () => json({ error, error_description: `server says ${error} happened` }, 400);

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe(`wif_${error}`);
      expect(exit.exitCode).toBe(4);
      const message = stderr.join('\n');
      expect(message).toContain(error);
      expect(message).toContain(`server says ${error} happened`);
      expect(message).toContain(hint);
    });

    it('non-JSON response: generic message with the HTTP status', async () => {
      tokenHandler = () => new Response('<html>Bad Gateway</html>', { status: 502 });

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_exchange_failed');
      expect(exit.exitCode).toBe(1);
      expect(stderr.join('\n')).toContain('HTTP 502');
      expect(stderr.join('\n')).toContain('not JSON');
      expect(stderr.join('\n')).not.toContain('Bad Gateway');
    });

    it('network error: generic message', async () => {
      tokenHandler = () => {
        throw new TypeError('fetch failed: ECONNREFUSED');
      };

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_exchange_failed');
      expect(stderr.join('\n')).toContain('Could not reach WORKOS_WIF_TOKEN_URL');
      expect(stderr.join('\n')).toContain('ECONNREFUSED');
    });

    it('success status without access_token: generic message with the HTTP status', async () => {
      tokenHandler = () => json({ token_type: 'Bearer', expires_in: 300 });

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_exchange_failed');
      expect(stderr.join('\n')).toContain('HTTP 200');
      expect(stderr.join('\n')).toContain('no access_token');
    });

    it('unrecognized OAuth error: generic message with the status and error', async () => {
      tokenHandler = () => json({ error: 'server_error', error_description: 'try later' }, 500);

      const exit = await expectCliExit(resolveApiKeyAsync());
      expect(exit.context?.errorCode).toBe('wif_exchange_failed');
      expect(stderr.join('\n')).toContain('HTTP 500');
      expect(stderr.join('\n')).toContain('server_error: try later');
    });

    it('verify-login refuses a WIF token, since it cannot confirm the environment is not production', async () => {
      const token = await resolveApiKeyAsync();

      const exit = await expectCliExit(
        runVerifyLogin({ apiKey: token, clientId: 'client_x', baseUrl: API_BASE, envType: null, method: 'password' }),
      );
      expect(exit.context?.errorCode).toBe('wif_unsupported_command');
      expect(stderr.join('\n')).toContain('sandbox');
      expect(apiCalls()).toHaveLength(0);
    });
  });

  it('never leaks either token', async () => {
    const messages: string[] = [];
    const writes: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    });

    async function capture(run: () => Promise<unknown>): Promise<void> {
      try {
        await run();
      } catch (error) {
        messages.push(String(error), error instanceof Error ? `${error.message}\n${error.stack}` : '');
      }
      resetWifCacheForTests();
    }

    for (const mode of ['human', 'json'] as const) {
      setOutputMode(mode);

      // Server echoes the assertion back in error_description.
      tokenHandler = () => json({ error: 'invalid_grant', error_description: `bad assertion ${GITHUB_JWT}` }, 400);
      await capture(() => resolveApiKeyAsync());

      // Network error whose message carries the assertion.
      tokenHandler = () => {
        throw new TypeError(`socket hang up while sending ${GITHUB_JWT}`);
      };
      await capture(() => resolveApiKeyAsync());

      // Unrecognized error echoing both tokens.
      tokenHandler = () =>
        json({ error: 'server_error', error_description: `${GITHUB_JWT} / ${ACCESS_TOKEN}`, access_token: '' }, 500);
      await capture(() => resolveApiKeyAsync());

      // Non-JSON body echoing the request.
      tokenHandler = () => new Response(`assertion=${GITHUB_JWT}`, { status: 400 });
      await capture(() => resolveApiKeyAsync());

      // Successful exchange, then failures downstream of it.
      tokenHandler = () => json({ access_token: ACCESS_TOKEN, token_type: 'Bearer', expires_in: 300 });
      await capture(async () => {
        const token = await resolveApiKeyAsync();
        await runVerifyLogin({
          apiKey: token,
          clientId: 'client_x',
          baseUrl: API_BASE,
          envType: null,
          method: 'password',
        });
      });
      await capture(async () => {
        const token = await resolveApiKeyAsync();
        apiHandler = () => json({ message: 'Unauthorized' }, 401);
        await workosRequest({ method: 'GET', path: '/organizations', apiKey: token, baseUrl: API_BASE });
      });
      apiHandler = () => json({ data: [], list_metadata: { before: null, after: null } });
    }

    // Debug-log and telemetry redaction helpers know both values.
    const redactedForTelemetry = [
      sanitizeMessage(`failed with ${GITHUB_JWT} and ${ACCESS_TOKEN}`),
      sanitizeStack(`Error: ${ACCESS_TOKEN}\n    at x (/src/lib/wif.ts:1:1)`),
      JSON.stringify(redactCredentials({ assertion: GITHUB_JWT, nested: { token: ACCESS_TOKEN } })),
    ];

    const everything = [...messages, ...writes, ...stdout, ...stderr, ...redactedForTelemetry].join('\n');
    expect(stderr.length).toBeGreaterThan(0);
    expect(everything).not.toContain(GITHUB_JWT);
    expect(everything).not.toContain(ACCESS_TOKEN);
    expect(everything).not.toContain(REQUEST_TOKEN);
  });
});
