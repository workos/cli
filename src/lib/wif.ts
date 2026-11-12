/**
 * Workload identity federation (WIF) for GitHub Actions.
 *
 * Lets the REST commands (`workos api`, connection, directory, audit-log,
 * vault, api-key, ...) run in a GitHub Actions workflow with no
 * WORKOS_API_KEY. The workflow's GitHub OIDC ID token is exchanged at WorkOS
 * for a short-lived access token (RFC 7523 `jwt-bearer` grant), which is then
 * the Bearer for API calls.
 *
 * The workflow (or job) needs `permissions: id-token: write`, otherwise
 * GitHub does not expose ACTIONS_ID_TOKEN_REQUEST_URL/_TOKEN.
 *
 * Credential order lives in api-key.ts: `--api-key` and WORKOS_API_KEY always
 * win; WIF applies only when getWifState() is 'ready'; otherwise the stored
 * profile key and today's errors apply unchanged.
 *
 * Retries are bounded. An exchange that fails with a network error or a 5xx
 * is retried with a fresh GitHub OIDC token each time, because WorkOS accepts
 * each one once; a 4xx is never retried. An API call answered with 401 is
 * re-sent once with a newly exchanged token (see sendWithWifAuth).
 *
 * The access token is cached in memory only and never written to disk, a
 * profile or config. Neither the GitHub JWT nor the WorkOS access token may
 * appear in output, errors, logs or telemetry: both are registered with the
 * redaction helpers and no message here interpolates either value.
 */

import { exitWithError } from '../utils/output.js';
import { redactRegisteredSecrets, registerSecret } from '../utils/redact.js';

export const WIF_DEFAULT_AUDIENCE = 'https://api.workos.com';
export const WIF_RESOURCE = 'https://api.workos.com';
export const WIF_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:jwt-bearer';
export const ENVIRONMENT_ID_HEADER = 'x-url-environment-id';

/** Refresh once less than this much lifetime is left, or less than 20% of it, whichever is smaller. */
const REFRESH_MARGIN_MAX_MS = 60_000;
const REFRESH_MARGIN_FRACTION = 0.2;
/** Lifetime to assume when the server omits `expires_in`: the documented minimum (5 min). */
const DEFAULT_LIFETIME_SECONDS = 300;
/** Exchange attempts in total (the first try plus retries) when the token endpoint is unreachable or answers 5xx. */
const MAX_EXCHANGE_ATTEMPTS = 3;
/** Wait before the second attempt; doubles for each one after. */
const DEFAULT_RETRY_BACKOFF_MS = 500;
/** Cap on server-provided `error_description` text echoed into an error message. */
const MAX_DESCRIPTION_LENGTH = 500;

export const WIF_ERROR_CODES = {
  idTokenUnavailable: 'wif_id_token_unavailable',
  idTokenRequestFailed: 'wif_id_token_request_failed',
  tokenUrlMissing: 'wif_token_url_missing',
  tokenUrlInvalid: 'wif_token_url_invalid',
  exchangeFailed: 'wif_exchange_failed',
  unsupportedCommand: 'wif_unsupported_command',
} as const;

const ID_TOKEN_PERMISSION_HINT =
  'Add `permissions: id-token: write` to the workflow or job so GitHub Actions can issue an OIDC token.';

/** OAuth errors the token endpoint returns, with a one-line hint each. Exit code: `wif_<error>`. */
const OAUTH_ERROR_HINTS: Record<string, string> = {
  invalid_grant:
    "None of the M2M application's trust rules matched this workflow run, or the GitHub OIDC token expired or was already used. " +
    "Check the trust rule's repository, ref and audience against this run, and that the trust rule is enabled, then re-run the job.",
  invalid_target: `The resource or audience is wrong. Set the trust rule's audience and WORKOS_WIF_AUDIENCE to the same value (default ${WIF_DEFAULT_AUDIENCE}).`,
  invalid_client:
    'Set WORKOS_CLIENT_ID to the client ID of the M2M application that has the GitHub trust rule, ' +
    'and check that WORKOS_WIF_TOKEN_URL belongs to the same WorkOS environment as that application.',
  unauthorized_client:
    "This client isn't allowed to use workload identity federation. " +
    'Check that WORKOS_CLIENT_ID is an M2M application with an enabled GitHub trust rule, ' +
    'that workload identity federation is turned on for your WorkOS team, ' +
    'and that the application targets a non-production environment.',
  invalid_scope:
    'The requested scope is not one the M2M application may be granted. ' +
    "Set WORKOS_WIF_SCOPE to scopes the application has, or unset it to get the application's default scopes.",
  invalid_request:
    'The token request was malformed. Check that WORKOS_WIF_TOKEN_URL points at the /oauth2/token endpoint.',
};

/**
 * - `off`: not GitHub Actions, or no WORKOS_CLIENT_ID. WIF is not attempted.
 * - `missing_id_token_env`: GitHub Actions with WORKOS_CLIENT_ID, but the job
 *   can't request an OIDC token (no `id-token: write` permission).
 * - `ready`: all WIF conditions hold.
 */
export type WifState = 'off' | 'missing_id_token_env' | 'ready';

export function getWifState(): WifState {
  if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.WORKOS_CLIENT_ID) return 'off';
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL || !process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    return 'missing_id_token_env';
  }
  return 'ready';
}

/** Exit for the `missing_id_token_env` state when no other credential exists. */
export function exitWithMissingIdTokenPermission(): never {
  exitWithError({
    code: WIF_ERROR_CODES.idTokenUnavailable,
    message: `WORKOS_CLIENT_ID is set in GitHub Actions, but this job can't request an OIDC token (ACTIONS_ID_TOKEN_REQUEST_URL / ACTIONS_ID_TOKEN_REQUEST_TOKEN are missing). ${ID_TOKEN_PERMISSION_HINT} Or set WORKOS_API_KEY.`,
  });
}

/** Exit when WIF is the credential but the call site can't wait for the exchange. */
export function exitWithWifUnsupported(): never {
  exitWithError({
    code: WIF_ERROR_CODES.unsupportedCommand,
    message:
      "This command can't authenticate with workload identity federation (WIF) yet. Set WORKOS_API_KEY for this step.",
  });
}

interface CachedToken {
  value: string;
  /** Epoch ms after which the token is exchanged again. */
  refreshAt: number;
}

let cached: CachedToken | undefined;
let inFlight: Promise<string> | undefined;
/** Every access token this process obtained, so request layers can recognize one. */
const issuedTokens = new Set<string>();

/** True when `credential` is a WorkOS access token obtained through WIF in this process. */
export function isWifAccessToken(credential: string | undefined): boolean {
  return credential !== undefined && issuedTokens.has(credential);
}

/**
 * The latest WIF access token, for synchronous credential resolution.
 * Undefined until getWifAccessToken() has resolved once. Request layers swap
 * it for a fresh one via wifAuthHeaders(), so a stale value is never sent.
 */
export function peekWifAccessToken(): string | undefined {
  return cached?.value;
}

/**
 * A valid WorkOS access token, exchanging only when there is none or the
 * cached one is inside the refresh margin. Concurrent callers share one
 * in-flight exchange. Failures exit via exitWithError and are not cached.
 */
export function getWifAccessToken(): Promise<string> {
  if (cached && Date.now() < cached.refreshAt) return Promise.resolve(cached.value);
  inFlight ??= exchangeForAccessToken()
    .then((token) => {
      cached = token;
      issuedTokens.add(token.value);
      return token.value;
    })
    .finally(() => {
      inFlight = undefined;
    });
  return inFlight;
}

/**
 * Request headers for a REST credential. An API key passes through exactly as
 * before; a WIF token is refreshed if needed and gets `x-url-environment-id`
 * when WORKOS_ENVIRONMENT_ID is set. The header is optional: the M2M
 * application is bound to one environment, and a value that is sent must match it.
 */
export async function wifAuthHeaders(credential: string): Promise<Record<string, string>> {
  if (!isWifAccessToken(credential)) return { Authorization: `Bearer ${credential}` };
  const token = await getWifAccessToken();
  const environmentId = process.env.WORKOS_ENVIRONMENT_ID;
  return {
    Authorization: `Bearer ${token}`,
    ...(environmentId && { [ENVIRONMENT_ID_HEADER]: environmentId }),
  };
}

/** Drop `token` from the cache so the next getWifAccessToken() exchanges again. No-op if it was already replaced. */
function discardWifAccessToken(token: string): void {
  if (cached?.value === token) cached = undefined;
}

/**
 * Send an API request with the headers for `credential`, via `send`.
 *
 * An API key is sent once, exactly as before. A WIF token is refreshed first
 * if needed, and if the API answers 401 (the token expired or was rejected in
 * flight) the token is dropped, exchanged again and the request re-sent once.
 * A second 401 is returned to the caller. `send` must be safe to call twice;
 * a 401 means the API did not act on the first call.
 */
export async function sendWithWifAuth(
  credential: string,
  send: (authHeaders: Record<string, string>) => Promise<Response>,
): Promise<Response> {
  const authHeaders = await wifAuthHeaders(credential);
  const response = await send(authHeaders);
  if (response.status !== 401 || !isWifAccessToken(credential)) return response;

  discardWifAccessToken(authHeaders.Authorization.slice('Bearer '.length));
  // Release the first response's connection before exchanging again, so a
  // failed exchange does not leave it open. Its body is never read.
  await response.body?.cancel().catch(() => undefined);
  const retryHeaders = await wifAuthHeaders(credential);
  return send(retryHeaders);
}

/**
 * fetch for the WorkOS SDK, which fixes its Authorization header at
 * construction: re-applies wifAuthHeaders() on every request so a long run
 * never sends an expired token, and re-sends once on a 401.
 */
export function createWifFetch(credential: string): typeof fetch {
  return async (input, init) => {
    // A Request or a stream body can be consumed only once, so those are not re-sent.
    const replayable =
      !(input instanceof Request) &&
      (init?.body == null || typeof init.body === 'string' || init.body instanceof URLSearchParams);
    const send = (authHeaders: Record<string, string>): Promise<Response> => {
      const headers = new Headers(init?.headers);
      for (const [name, value] of Object.entries(authHeaders)) headers.set(name, value);
      return fetch(input, { ...init, headers });
    };
    return replayable ? sendWithWifAuth(credential, send) : send(await wifAuthHeaders(credential));
  };
}

let retryBackoffMs = DEFAULT_RETRY_BACKOFF_MS;

/** Test-only: forget cached and issued tokens. */
export function resetWifCacheForTests(): void {
  cached = undefined;
  inFlight = undefined;
  issuedTokens.clear();
}

/** Test-only: shorten the wait between exchange attempts. */
export function setWifRetryBackoffForTests(ms: number): void {
  retryBackoffMs = ms;
}

function resolveTokenUrl(): string {
  const raw = process.env.WORKOS_WIF_TOKEN_URL;
  // No default yet: the WorkOS side of this grant (`workos-api-workload-identity`) is
  // still being built and has no production endpoint. The default will come
  // once the server ships.
  if (!raw) {
    exitWithError({
      code: WIF_ERROR_CODES.tokenUrlMissing,
      message:
        'WORKOS_WIF_TOKEN_URL is required for workload identity federation in GitHub Actions. ' +
        'The WorkOS server side is still being built, so there is no default yet. ' +
        'Set it to your token endpoint, shaped like https://<your AuthKit domain>/oauth2/token.',
    });
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    exitWithError({
      code: WIF_ERROR_CODES.tokenUrlInvalid,
      message: 'WORKOS_WIF_TOKEN_URL is not a valid URL. Expected https://<your AuthKit domain>/oauth2/token.',
    });
  }
  // The assertion is a bearer credential: plain http only to this machine.
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback)) {
    exitWithError({
      code: WIF_ERROR_CODES.tokenUrlInvalid,
      message: 'WORKOS_WIF_TOKEN_URL must use https (http is allowed only for localhost).',
    });
  }
  return raw;
}

function describeNetworkError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return redactRegisteredSecrets(detail);
}

async function readJsonObject(response: Response): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    return undefined;
  }
  return parseJsonObject(text);
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function requestGitHubIdToken(audience: string): Promise<string> {
  const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!requestUrl || !requestToken) exitWithMissingIdTokenPermission();
  registerSecret(requestToken);

  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    exitWithError({
      code: WIF_ERROR_CODES.idTokenRequestFailed,
      message: 'ACTIONS_ID_TOKEN_REQUEST_URL is not a valid URL, so no GitHub OIDC token could be requested.',
    });
  }
  url.searchParams.set('audience', audience);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${requestToken}`, Accept: 'application/json' },
    });
  } catch (error) {
    exitWithError({
      code: WIF_ERROR_CODES.idTokenRequestFailed,
      message: `Could not reach GitHub to request an OIDC token: ${describeNetworkError(error)}`,
    });
  }

  if (response.status === 401 || response.status === 403) {
    exitWithError({
      code: WIF_ERROR_CODES.idTokenUnavailable,
      message: `GitHub refused to issue an OIDC token (HTTP ${response.status}). ${ID_TOKEN_PERMISSION_HINT}`,
      apiContext: { status: response.status },
    });
  }
  if (!response.ok) {
    exitWithError({
      code: WIF_ERROR_CODES.idTokenRequestFailed,
      message: `GitHub OIDC token request failed (HTTP ${response.status}).`,
      apiContext: { status: response.status },
    });
  }

  const body = await readJsonObject(response);
  const value = body?.value;
  if (typeof value !== 'string' || value === '') {
    exitWithError({
      code: WIF_ERROR_CODES.idTokenRequestFailed,
      message: `GitHub OIDC token response had no token (HTTP ${response.status}).`,
      apiContext: { status: response.status },
    });
  }
  registerSecret(value);
  return value;
}

/** A failed attempt that is worth repeating: `fail` reports it if no attempt is left. */
interface RetryableFailure {
  fail: (attempts: number) => never;
}

function attemptsSuffix(attempts: number): string {
  return attempts > 1 ? ` Gave up after ${attempts} attempts.` : '';
}

/**
 * Exchange with bounded retries. Only a network error or a 5xx from the token
 * endpoint is retried; every 4xx (and any GitHub-side failure) exits at once.
 */
async function exchangeForAccessToken(): Promise<CachedToken> {
  // Fail on configuration before any network call.
  const tokenUrl = resolveTokenUrl();
  const audience = process.env.WORKOS_WIF_AUDIENCE || WIF_DEFAULT_AUDIENCE;

  for (let attempt = 1; ; attempt++) {
    // A fresh GitHub OIDC token for every attempt: WorkOS accepts each one
    // once, and a failed attempt may already have consumed it.
    const assertion = await requestGitHubIdToken(audience);
    const result = await attemptExchange(tokenUrl, assertion);
    if ('value' in result) return result;
    if (attempt >= MAX_EXCHANGE_ATTEMPTS) result.fail(attempt);
    await new Promise((resolve) => setTimeout(resolve, retryBackoffMs * 2 ** (attempt - 1)));
  }
}

async function attemptExchange(tokenUrl: string, assertion: string): Promise<CachedToken | RetryableFailure> {
  const form = new URLSearchParams({
    grant_type: WIF_GRANT_TYPE,
    assertion,
    client_id: process.env.WORKOS_CLIENT_ID ?? '',
    resource: WIF_RESOURCE,
  });
  const scope = process.env.WORKOS_WIF_SCOPE;
  if (scope) form.set('scope', scope);

  // Lifetime counts from before the request, so the cache errs early.
  const requestedAt = Date.now();
  let response: Response;
  let text: string;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
    // A connection that drops while the body is read is a network failure too.
    text = await response.text();
  } catch (error) {
    const detail = describeNetworkError(error);
    return {
      fail: (attempts) =>
        exitWithError({
          code: WIF_ERROR_CODES.exchangeFailed,
          message:
            `Could not reach WORKOS_WIF_TOKEN_URL for the WIF token exchange: ${detail}.${attemptsSuffix(attempts)} ` +
            'Check that WORKOS_WIF_TOKEN_URL is right and reachable from this runner, then re-run the job.',
        }),
    };
  }

  const body = parseJsonObject(text);
  const oauthError = typeof body?.error === 'string' ? body.error : undefined;
  const description =
    typeof body?.error_description === 'string' && body.error_description
      ? redactRegisteredSecrets(body.error_description).slice(0, MAX_DESCRIPTION_LENGTH)
      : undefined;
  const status = response.status;

  if (status >= 500) {
    let reason: string;
    if (!body) reason = 'the response was not JSON';
    else if (oauthError) reason = `${oauthError}${description ? `: ${description}` : ''}`;
    else reason = 'unexpected error response';
    return {
      fail: (attempts) =>
        exitWithError({
          code: WIF_ERROR_CODES.exchangeFailed,
          message:
            `WIF token exchange at WORKOS_WIF_TOKEN_URL failed (HTTP ${status}): ${reason}.${attemptsSuffix(attempts)} ` +
            'This is a server-side failure; re-run the job, and check WORKOS_WIF_TOKEN_URL if it keeps happening.',
          apiContext: { status },
        }),
    };
  }

  if (oauthError && Object.hasOwn(OAUTH_ERROR_HINTS, oauthError)) {
    exitWithError({
      code: `wif_${oauthError}`,
      message: `WorkOS rejected the WIF token exchange with ${oauthError}${description ? `: ${description}` : ''}. ${OAUTH_ERROR_HINTS[oauthError]}`,
      apiContext: { status, code: oauthError },
    });
  }

  const accessToken = body?.access_token;
  if (!response.ok || typeof accessToken !== 'string' || accessToken === '') {
    let reason: string;
    if (!body) reason = 'the response was not JSON';
    else if (oauthError) reason = `${oauthError}${description ? `: ${description}` : ''}`;
    else if (!response.ok) reason = 'unexpected error response';
    else reason = 'the response had no access_token';
    exitWithError({
      code: WIF_ERROR_CODES.exchangeFailed,
      message: `WIF token exchange at WORKOS_WIF_TOKEN_URL failed (HTTP ${status}): ${reason}. Check that WORKOS_WIF_TOKEN_URL is the /oauth2/token endpoint of your WorkOS environment.`,
      apiContext: { status },
    });
  }
  registerSecret(accessToken);

  const reportedLifetime = Number(body?.expires_in);
  const expiresIn =
    Number.isFinite(reportedLifetime) && reportedLifetime > 0 ? reportedLifetime : DEFAULT_LIFETIME_SECONDS;
  const lifetimeMs = expiresIn * 1000;
  const marginMs = Math.min(REFRESH_MARGIN_MAX_MS, lifetimeMs * REFRESH_MARGIN_FRACTION);
  return { value: accessToken, refreshAt: requestedAt + lifetimeMs - marginMs };
}
