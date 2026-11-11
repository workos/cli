/**
 * Shared plumbing for the API-key adapters: an authenticated REST request
 * helper and the paging/not-found helpers every resource file uses.
 *
 * Adapters translate one catalog operation into WorkOS REST calls and return
 * the data in the SAME shape the dashboard operation returns, selecting only
 * the fields that operation's document selects. The command's existing shaper
 * then produces the `--json` output, so both paths emit identical keys and
 * casing by construction. Fields the REST API has no source for come back
 * `null` (never invented); they are listed in the parity ACCEPTED map.
 */

import { workosRequest, WorkOSApiError, type WorkOSRequestOptions, type WorkOSListResponse } from '../workos-api.js';
import type { ApiKeyAuth } from '../resource-auth.js';
import { exitWithError } from '../../utils/output.js';
import { formatWorkOSCommand } from '../../utils/command-invocation.js';

export type Variables = Record<string, unknown>;

export type RequestOptions = Omit<WorkOSRequestOptions, 'apiKey' | 'baseUrl'>;

export interface ApiKeyContext {
  auth: ApiKeyAuth;
  request<T>(options: RequestOptions): Promise<T>;
}

/** Adapter: catalog-operation variables in, dashboard-shaped data out. */
export type ApiKeyOperation = (variables: Variables, ctx: ApiKeyContext) => Promise<unknown>;

export function createContext(auth: ApiKeyAuth): ApiKeyContext {
  return {
    auth,
    request: <T>(options: RequestOptions) =>
      workosRequest<T>({ ...options, apiKey: auth.apiKey, baseUrl: auth.baseUrl }),
  };
}

export function isNotFound(error: unknown): boolean {
  return error instanceof WorkOSApiError && error.statusCode === 404;
}

/** Run a read; a REST 404 resolves to `null` so the command's own not-found branch runs. */
export async function orNull<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/** Marks a REST 404, distinct from a 2xx with an empty body (which `workosRequest` returns as `null`). */
export const NOT_FOUND = Symbol('not_found');

/** Run a request; a REST 404 resolves to {@link NOT_FOUND}, so an empty success can't pass for "missing". */
export async function orNotFound<T>(request: Promise<T>): Promise<T | typeof NOT_FOUND> {
  try {
    return await request;
  } catch (error) {
    if (isNotFound(error)) return NOT_FOUND;
    throw error;
  }
}

/** The dashboard list envelope: `{ data, listMetadata }`. */
export function listEnvelope<T>(data: T[], listMetadata?: { before: string | null; after: string | null }) {
  return {
    data,
    listMetadata: { before: listMetadata?.before ?? null, after: listMetadata?.after ?? null },
  };
}

/** REST page size used when an operation must return a complete list. */
const FULL_LIST_PAGE_SIZE = 100;
/** Hard stop for full-list reads, so a bad cursor can never loop forever. */
const FULL_LIST_MAX_PAGES = 50;

/**
 * Read every page of a REST list. Used where the dashboard operation returns a
 * complete, unpaginated list (permissions, a user's memberships, redirect URIs,
 * CORS origins).
 *
 * The order is always explicit: several endpoints default to `normal`, where
 * `after` walks toward NEWER records, so following `after` from the first page
 * would stop early and silently drop everything older. Under `desc`, `after`
 * is the next (older) page, which is what the loop follows.
 */
export async function listAll<T>(
  ctx: ApiKeyContext,
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T[]> {
  const items: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < FULL_LIST_MAX_PAGES; page++) {
    const result = await ctx.request<WorkOSListResponse<T> | { data: T[]; list_metadata?: undefined }>({
      method: 'GET',
      path,
      params: { order: 'desc', ...params, limit: FULL_LIST_PAGE_SIZE, ...(after ? { after } : {}) },
    });
    items.push(...(result?.data ?? []));
    after = result?.list_metadata?.after ?? undefined;
    if (!after) break;
  }
  return items;
}

/**
 * `Asc`/`Desc` (the dashboard pagination enum) → REST `asc`/`desc`, and `desc`
 * when no order was asked for. Always explicit: several REST lists default to
 * `normal` (newest first, but `after` walks toward NEWER records), and every
 * list on this path must keep the CLI's contract that `after` is the next
 * page. `desc` returns the same newest-first rows as `normal`.
 */
export function restOrder(order?: unknown): string {
  return typeof order === 'string' && order !== '' ? order.toLowerCase() : 'desc';
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function encode(segment: string): string {
  return encodeURIComponent(segment);
}

/**
 * Copy for something the API key can't do, naming what's missing. Exported so
 * the leak gate can check it; never name internal backends here.
 */
export function apiKeyUnsupportedMessage(missing: string): string {
  return (
    `This isn't available with an API key: ${missing}. ` +
    `Sign in with \`${formatWorkOSCommand('auth login')}\` and run it without --api-key or WORKOS_API_KEY. ` +
    `An unclaimed environment must be claimed first (\`${formatWorkOSCommand('profile claim')}\`).`
  );
}

/** Exit with a structured `api_key_unsupported` error. Never returns. */
export function exitApiKeyUnsupported(missing: string): never {
  exitWithError({ code: 'api_key_unsupported', message: apiKeyUnsupportedMessage(missing) });
}
