/**
 * Minimal GraphQL client for the WorkOS dashboard API, authenticated with the
 * logged-in user's OAuth bearer token.
 *
 * This is the *account plane*: the device-flow access token acts as the user
 * (resolving their team and environment), unlike the environment-scoped API key
 * that REST commands use via the WorkOS SDK. The dashboard `/graphql` endpoint
 * accepts the bearer through `DashboardOAuthBearerGuard`.
 *
 * The capability is enabled in production but gated server-side by a per-team
 * feature flag (fail-closed), so a 403 here remains an expected outcome
 * wherever the flag is off for the caller's team — callers should surface that
 * distinctly rather than as a generic failure.
 */

import { getWorkOSApiUrl } from '../utils/urls.js';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Apollo runs `csrfPrevention: { requestHeaders: ['X-CSRF-Token'] }`. A
 * `multipart/form-data` POST is a CORS-simple request, so Apollo demands one of
 * those headers to force a preflight that a cross-origin page could not survive.
 * The *value* is never checked for a bearer-authenticated request — the server's
 * CSRF guard short-circuits on the Authorization header, since a bearer request
 * cannot be forged by a browser in the first place — so any non-empty string
 * satisfies it. JSON requests need nothing here: `application/json` is itself a
 * non-simple content type and already forces the preflight.
 */
const MULTIPART_CSRF_HEADER_VALUE = 'workos-cli';

export type DashboardGraphqlErrorCode =
  | 'forbidden' // 401/403: capability disabled, or token not backed by a team
  | 'http_error' // other non-2xx
  | 'graphql_error' // 200 with an errors[] payload (or no data)
  | 'network_error'; // transport failure or timeout

export class DashboardGraphqlError extends Error {
  constructor(
    message: string,
    readonly code: DashboardGraphqlErrorCode,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DashboardGraphqlError';
  }
}

interface GraphqlResponseBody<T> {
  data?: T | null;
  errors?: Array<{ message: string }>;
}

export interface DashboardGraphqlOptions {
  /** The user's OAuth bearer access token. */
  token: string;
  variables?: Record<string, unknown>;
  /**
   * Optional environment to operate in. The guard validates it against the
   * caller's own team and falls back to the team's production environment when
   * unset or unrecognized (sent as the `x-url-environment-id` header).
   *
   * CLI-side invariant: environment-scoped commands must always pass an ID
   * resolved through `resolveEnvironmentTarget()` (environment-target.ts) —
   * never omit it and never pass an unvalidated stored ID into a mutation. The
   * server's silent production fallback means a missing/stale header misroutes
   * the request rather than failing; the resolver is what turns that into a
   * structured `environment_stale` / `environment_unresolved` error instead.
   * Team-scoped operations (memberships, project lifecycle) deliberately send
   * no environment header.
   */
  environmentId?: string;
  /**
   * Optional caller cancellation, merged into the request's own abort
   * controller so the socket dies with the caller's deadline instead of
   * holding the event loop open until the transport timeout. (The install
   * picker's bounded team discovery is the caller that needs this.)
   */
  signal?: AbortSignal;
}

/**
 * Execute a GraphQL operation against `<api>/graphql` with a bearer token.
 *
 * Resolves to the `data` payload, or throws a {@link DashboardGraphqlError}
 * classified by failure mode (forbidden / http / graphql / network).
 */
export async function dashboardGraphqlRequest<T>(query: string, options: DashboardGraphqlOptions): Promise<T> {
  return sendDashboardRequest<T>(
    options,
    { 'Content-Type': 'application/json' },
    JSON.stringify({ query, variables: options.variables ?? {} }),
  );
}

/** POST a prepared payload to `<api>/graphql`, classifying every failure mode. */
async function sendDashboardRequest<T>(
  options: DashboardGraphqlOptions,
  headers: Record<string, string>,
  payload: string | FormData,
): Promise<T> {
  const url = `${getWorkOSApiUrl()}/graphql`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  options.signal?.addEventListener('abort', () => controller.abort(), { once: true });

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        ...headers,
        Authorization: `Bearer ${options.token}`,
        ...(options.environmentId ? { 'x-url-environment-id': options.environmentId } : {}),
      },
      body: payload,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new DashboardGraphqlError('Request to the dashboard GraphQL API timed out', 'network_error');
    }
    throw new DashboardGraphqlError(
      `Could not reach the dashboard GraphQL API: ${error instanceof Error ? error.message : String(error)}`,
      'network_error',
    );
  } finally {
    clearTimeout(timeout);
  }

  if (res.status === 401 || res.status === 403) {
    throw new DashboardGraphqlError(
      `The dashboard GraphQL API rejected this session (HTTP ${res.status}).`,
      'forbidden',
      res.status,
    );
  }

  if (!res.ok) {
    throw new DashboardGraphqlError(`The dashboard GraphQL API returned HTTP ${res.status}.`, 'http_error', res.status);
  }

  let body: GraphqlResponseBody<T>;
  try {
    body = (await res.json()) as GraphqlResponseBody<T>;
  } catch (error) {
    throw new DashboardGraphqlError(
      `Invalid JSON from the dashboard GraphQL API: ${error instanceof Error ? error.message : String(error)}`,
      'network_error',
    );
  }

  if (body.errors?.length) {
    throw new DashboardGraphqlError(body.errors.map((e) => e.message).join('; '), 'graphql_error');
  }

  if (body.data == null) {
    throw new DashboardGraphqlError('The dashboard GraphQL API returned no data.', 'graphql_error');
  }

  return body.data;
}

/** One file to attach, bound to the variable slot it fills. */
export interface DashboardUploadFile {
  /**
   * Dotted path to the variable this file substitutes into, rooted at
   * `variables` (e.g. `variables.input.lightLogoFile`). The slot MUST hold
   * `null` in `options.variables` — see {@link assertNullPlaceholder}.
   */
  variablePath: string;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * Execute a GraphQL operation carrying file uploads, using the GraphQL
 * multipart request spec: an `operations` field (the ordinary JSON body, with
 * `null` standing in for each file), a `map` field binding each file part to a
 * variable path, and one part per file.
 *
 * This is the whole reason a CLI can set branding assets when an MCP server
 * cannot: `Upload` is not a JSON-representable scalar, so it needs a transport
 * that can carry bytes. MCP tool arguments are JSON Schema and have no file
 * type; raw HTTP has multipart. Same endpoint, same bearer token, no extra
 * server surface.
 */
export async function dashboardGraphqlUpload<T>(
  query: string,
  options: DashboardGraphqlOptions & { files: DashboardUploadFile[] },
): Promise<T> {
  if (options.files.length === 0) {
    throw new DashboardGraphqlError('An upload request requires at least one file.', 'graphql_error');
  }

  const variables = options.variables ?? {};
  const form = new FormData();
  const map: Record<string, [string]> = {};

  options.files.forEach((file, index) => {
    assertNullPlaceholder(variables, file.variablePath);
    map[String(index)] = [file.variablePath];
  });

  form.append('operations', JSON.stringify({ query, variables }));
  form.append('map', JSON.stringify(map));
  options.files.forEach((file, index) => {
    form.append(String(index), new Blob([file.bytes], { type: file.contentType }), file.filename);
  });

  // No explicit Content-Type: `fetch` derives it from the FormData so the
  // multipart boundary matches the body it actually encodes.
  return sendDashboardRequest<T>(options, { 'X-CSRF-Token': MULTIPART_CSRF_HEADER_VALUE }, form);
}

/**
 * Verify a file's declared variable path resolves to an existing slot holding
 * `null`, throwing otherwise.
 *
 * This is a correctness guard, not defensive noise. The server substitutes
 * files by walking `map` paths; a path that matches nothing is silently
 * ignored, leaving the literal `null` in place. For `updateAppBranding` a null
 * image field means "clear this asset", so a mistyped path would quietly
 * DELETE the branding image the caller was trying to upload. Fail loudly here
 * instead.
 */
function assertNullPlaceholder(variables: Record<string, unknown>, variablePath: string): void {
  const segments = variablePath.split('.');
  if (segments.shift() !== 'variables' || segments.length === 0) {
    throw new DashboardGraphqlError(`Upload path "${variablePath}" must be rooted at "variables".`, 'graphql_error');
  }

  let cursor: unknown = variables;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object' || !(segment in cursor)) {
      throw new DashboardGraphqlError(
        `Upload path "${variablePath}" does not exist in the variables.`,
        'graphql_error',
      );
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }

  if (cursor !== null) {
    throw new DashboardGraphqlError(`Upload path "${variablePath}" must be null in the variables.`, 'graphql_error');
  }
}
