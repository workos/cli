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
    "The M2M application's trust rules didn't match this repository or ref, or the GitHub OIDC token expired.",
  invalid_target: `The resource or audience is wrong: the trust rule's audience must match WORKOS_WIF_AUDIENCE (default ${WIF_DEFAULT_AUDIENCE}).`,
  invalid_client: 'Check that WORKOS_CLIENT_ID is the client ID of the M2M application that has the GitHub trust rule.',
  invalid_scope:
    'WORKOS_WIF_SCOPE asked for a scope the M2M application is not allowed. Fix or unset WORKOS_WIF_SCOPE.',
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
export function exitWithWifUnsupported(command = 'This command'): never {
  exitWithError({
    code: WIF_ERROR_CODES.unsupportedCommand,
    message: `${command} can't authenticate with workload identity federation (WIF) yet. Set WORKOS_API_KEY for this step.`,
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
 * when WORKOS_ENVIRONMENT_ID is set (machine tokens need it).
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

/**
 * fetch for the WorkOS SDK, which fixes its Authorization header at
 * construction: re-applies wifAuthHeaders() on every request so a long run
 * never sends an expired token.
 */
export function createWifFetch(credential: string): typeof fetch {
  return async (input, init) => {
    const headers = new Headers(init?.headers);
    for (const [name, value] of Object.entries(await wifAuthHeaders(credential))) {
      headers.set(name, value);
    }
    return fetch(input, { ...init, headers });
  };
}

/** Test-only: forget cached and issued tokens. */
export function resetWifCacheForTests(): void {
  cached = undefined;
  inFlight = undefined;
  issuedTokens.clear();
}

function resolveTokenUrl(): string {
  const raw = process.env.WORKOS_WIF_TOKEN_URL;
  // No default yet: the WorkOS side of this grant (`management-api-oauth`) is
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

async function exchangeForAccessToken(): Promise<CachedToken> {
  // Fail on configuration before any network call.
  const tokenUrl = resolveTokenUrl();
  const audience = process.env.WORKOS_WIF_AUDIENCE || WIF_DEFAULT_AUDIENCE;
  const assertion = await requestGitHubIdToken(audience);

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
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
  } catch (error) {
    exitWithError({
      code: WIF_ERROR_CODES.exchangeFailed,
      message: `Could not reach WORKOS_WIF_TOKEN_URL for the WIF token exchange: ${describeNetworkError(error)}`,
    });
  }

  const body = await readJsonObject(response);
  const oauthError = typeof body?.error === 'string' ? body.error : undefined;
  const description =
    typeof body?.error_description === 'string' && body.error_description
      ? redactRegisteredSecrets(body.error_description).slice(0, MAX_DESCRIPTION_LENGTH)
      : undefined;

  if (oauthError && Object.hasOwn(OAUTH_ERROR_HINTS, oauthError)) {
    exitWithError({
      code: `wif_${oauthError}`,
      message: `WorkOS rejected the WIF token exchange with ${oauthError}${description ? `: ${description}` : ''}. ${OAUTH_ERROR_HINTS[oauthError]}`,
      apiContext: { status: response.status, code: oauthError },
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
      message: `WIF token exchange at WORKOS_WIF_TOKEN_URL failed (HTTP ${response.status}): ${reason}.`,
      apiContext: { status: response.status },
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
