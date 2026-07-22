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
   */
  environmentId?: string;
}

/**
 * Execute a GraphQL operation against `<api>/graphql` with a bearer token.
 *
 * Resolves to the `data` payload, or throws a {@link DashboardGraphqlError}
 * classified by failure mode (forbidden / http / graphql / network).
 */
export async function dashboardGraphqlRequest<T>(query: string, options: DashboardGraphqlOptions): Promise<T> {
  const url = `${getWorkOSApiUrl()}/graphql`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.token}`,
        ...(options.environmentId ? { 'x-url-environment-id': options.environmentId } : {}),
      },
      body: JSON.stringify({ query, variables: options.variables ?? {} }),
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
