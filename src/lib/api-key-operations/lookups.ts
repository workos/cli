/**
 * Extra REST reads that fill fields the dashboard returns inline but REST
 * returns only as IDs or slugs: role IDs/names behind membership role slugs,
 * and organization names behind `organization_id`. Memoized per adapter call
 * (one context), so a page of results costs one read per distinct key.
 */

import { type ApiKeyContext, encode, listAll, orNull } from './context.js';

export interface RestRole {
  object?: 'role';
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  type?: string;
  resource_type_slug?: string;
  permissions?: string[];
  created_at?: string;
  updated_at?: string;
}

interface Memo {
  environmentRoles?: Promise<RestRole[]>;
  organizationRoles: Map<string, Promise<RestRole[] | null>>;
  organizationNames: Map<string, Promise<string | null>>;
}

const memos = new WeakMap<ApiKeyContext, Memo>();

function memoFor(ctx: ApiKeyContext): Memo {
  let memo = memos.get(ctx);
  if (!memo) {
    memo = { organizationRoles: new Map(), organizationNames: new Map() };
    memos.set(ctx, memo);
  }
  return memo;
}

export function environmentRoles(ctx: ApiKeyContext): Promise<RestRole[]> {
  const memo = memoFor(ctx);
  memo.environmentRoles ??= ctx
    .request<{ data: RestRole[] }>({ method: 'GET', path: '/authorization/roles' })
    .then((result) => result?.data ?? []);
  return memo.environmentRoles;
}

/**
 * Roles assignable in an organization: its own custom roles plus the
 * environment roles it inherits. `null` when REST can't list them (e.g. the
 * organization is gone).
 */
export function organizationRoles(ctx: ApiKeyContext, organizationId: string): Promise<RestRole[] | null> {
  const memo = memoFor(ctx);
  let roles = memo.organizationRoles.get(organizationId);
  if (!roles) {
    roles = orNull(
      ctx.request<{ data: RestRole[] }>({
        method: 'GET',
        path: `/authorization/organizations/${encode(organizationId)}/roles`,
      }),
    ).then((result) => (result ? (result.data ?? []) : null));
    memo.organizationRoles.set(organizationId, roles);
  }
  return roles;
}

/**
 * Find a role by ID or slug as the organization sees it. An organization's
 * custom role can reuse an environment role's slug and then wins inside that
 * organization (as on the dashboard), so with an `organizationId` the
 * organization's roles are searched first, preferring its custom role; the
 * environment roles are the fallback.
 */
export async function findRole(
  ctx: ApiKeyContext,
  match: { id?: string; slug?: string },
  organizationId?: string | null,
): Promise<RestRole | undefined> {
  const matches = (role: RestRole) => (match.id ? role.id === match.id : role.slug === match.slug);
  if (organizationId) {
    const candidates = ((await organizationRoles(ctx, organizationId)) ?? []).filter(matches);
    const found = candidates.find((role) => role.type === 'OrganizationRole') ?? candidates[0];
    if (found) return found;
  }
  return (await environmentRoles(ctx)).find(matches);
}

/** An organization's name, or `null` when it can't be read. */
export function organizationName(ctx: ApiKeyContext, organizationId: string): Promise<string | null> {
  const memo = memoFor(ctx);
  let name = memo.organizationNames.get(organizationId);
  if (!name) {
    name = orNull(
      ctx.request<{ name?: string }>({ method: 'GET', path: `/organizations/${encode(organizationId)}` }),
    ).then((org) => org?.name ?? null);
    memo.organizationNames.set(organizationId, name);
  }
  return name;
}

/** Map with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface RestMembership {
  object?: 'organization_membership';
  id: string;
  user_id: string;
  organization_id: string;
  organization_name?: string | null;
  status?: string | null;
  role?: { slug: string } | null;
  roles?: Array<{ slug: string }> | null;
  directory_managed?: boolean;
  created_at?: string;
  updated_at?: string;
}

export function membershipsForUser(ctx: ApiKeyContext, userId: string): Promise<RestMembership[]> {
  return listAll<RestMembership>(ctx, '/user_management/organization_memberships', { user_id: userId });
}
