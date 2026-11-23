/**
 * A `fetch` stub for the WorkOS REST API, for specs that exercise the API-key
 * path end to end (real `workosRequest`, real adapters).
 *
 * Routes are keyed `METHOD /path` (no query string). A route value is the
 * JSON body to return with 200, a `{ status, body }` pair, or a function of
 * the request. Unrouted requests get a REST-style 404 so not-found handling is
 * exercised, and every call is recorded for assertions.
 */

import { vi } from 'vitest';

export interface RestCall {
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  authorization: string | undefined;
}

export interface RestReply {
  status: number;
  body?: unknown;
}

export type RestRoute = unknown | RestReply | ((call: RestCall) => unknown | RestReply);

function isReply(value: unknown): value is RestReply {
  return typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'number';
}

export function createRestMock() {
  let routes: Record<string, RestRoute> = {};
  const calls: RestCall[] = [];

  const fetchMock = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = (init.headers ?? {}) as Record<string, string>;
    // Routes are written decoded (`/authorization/permissions/users:read`).
    const path = decodeURIComponent(url.pathname);
    const call: RestCall = {
      method,
      path,
      query: Object.fromEntries(url.searchParams.entries()),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      authorization: headers.Authorization,
    };
    calls.push(call);

    const key = `${method} ${path}`;
    if (!(key in routes)) {
      return new Response(JSON.stringify({ message: `Not found: ${key}` }), { status: 404 });
    }
    const route = routes[key];
    const resolved = typeof route === 'function' ? (route as (call: RestCall) => unknown)(call) : route;
    const reply = isReply(resolved) ? resolved : { status: 200, body: resolved };
    if (reply.status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
  });

  return {
    fetchMock,
    calls,
    /** Replace the route table (and clear recorded calls). */
    respond(next: Record<string, RestRoute>): void {
      routes = next;
      calls.length = 0;
    },
    /** Calls matching `METHOD /path`. */
    callsTo(key: string): RestCall[] {
      return calls.filter((call) => `${call.method} ${call.path}` === key);
    },
  };
}

/** A REST list envelope, as the WorkOS API returns it. */
export function restList<T>(data: T[], after: string | null = null, before: string | null = null) {
  return { object: 'list', data, list_metadata: { before, after } };
}
