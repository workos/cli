import type { Context } from 'hono';
import { type RouteContext, notFound, validationError, parseJsonBody, parseListParams } from '../core/index.js';
import type { WorkOSStore } from './store.js';
import type { WorkOSRole, WorkOSPermission } from './entities.js';
import { getWorkOSStore } from './store.js';
import { formatRole, formatPermission, formatListResponse } from './helpers.js';

export function findEnvRole(ws: WorkOSStore, slug: string): WorkOSRole | undefined {
  return ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
}

export function findOrgRole(ws: WorkOSStore, orgId: string, slug: string): WorkOSRole | undefined {
  return ws.roles.findBy('organization_id', orgId).find((r) => r.slug === slug && r.type === 'OrganizationRole');
}

export function requireEnvRole(ws: WorkOSStore, slug: string): WorkOSRole {
  const role = findEnvRole(ws, slug);
  if (!role) throw notFound('Role');
  return role;
}

export function requireOrgRole(ws: WorkOSStore, orgId: string, slug: string): WorkOSRole {
  const role = findOrgRole(ws, orgId, slug);
  if (!role) throw notFound('Role');
  return role;
}

export function getRolePermissions(ws: WorkOSStore, roleId: string): WorkOSPermission[] {
  const rps = ws.rolePermissions.findBy('role_id', roleId);
  return rps.map((rp) => ws.permissions.get(rp.permission_id)).filter(Boolean) as WorkOSPermission[];
}

export function replaceRolePermissions(ws: WorkOSStore, roleId: string, permissionSlugs: string[]): WorkOSPermission[] {
  // Delete existing
  ws.rolePermissions.deleteBy('role_id', roleId);

  // Insert new
  for (const permSlug of permissionSlugs) {
    const perm = ws.permissions.findOneBy('slug', permSlug);
    if (!perm) throw notFound('Permission');
    ws.rolePermissions.insert({ role_id: roleId, permission_id: perm.id });
  }

  return getRolePermissions(ws, roleId);
}

export interface RoleRouteConfig {
  pathPrefix: string;
  roleType: 'EnvironmentRole' | 'OrganizationRole';
  requireRole: (ws: WorkOSStore, c: Context) => WorkOSRole;
  findRole: (ws: WorkOSStore, c: Context, slug: string) => WorkOSRole | undefined;
  listFilter: (c: Context) => (r: WorkOSRole) => boolean;
  insertDefaults: (c: Context) => Partial<WorkOSRole>;
  duplicateMessage: string;
  validateBeforeCreate?: (ws: WorkOSStore, c: Context) => void;
}

export function registerRoleRoutes(ctx: RouteContext, config: RoleRouteConfig): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);
  const { pathPrefix } = config;

  app.post(pathPrefix, async (c) => {
    config.validateBeforeCreate?.(ws, c);

    const body = await parseJsonBody(c);
    const slug = body.slug as string;
    const name = body.name as string;

    if (!slug || typeof slug !== 'string') {
      throw validationError('slug is required', [{ field: 'slug', code: 'required' }]);
    }
    if (!name || typeof name !== 'string') {
      throw validationError('name is required', [{ field: 'name', code: 'required' }]);
    }

    const existing = config.findRole(ws, c, slug);
    if (existing) {
      throw validationError(config.duplicateMessage, [{ field: 'slug', code: 'duplicate' }]);
    }

    const defaults = config.insertDefaults(c);
    const role = ws.roles.insert({
      object: 'role',
      slug,
      name,
      description: (body.description as string) ?? null,
      type: config.roleType,
      organization_id: defaults.organization_id ?? null,
      is_default_role: Boolean(body.is_default_role),
      priority: typeof body.priority === 'number' ? body.priority : 0,
    });

    return c.json(formatRole(role), 201);
  });

  app.get(pathPrefix, (c) => {
    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.roles.list({
      ...params,
      filter: config.listFilter(c),
    });

    return c.json(formatListResponse(result, formatRole));
  });

  app.get(`${pathPrefix}/:slug`, (c) => {
    const role = config.requireRole(ws, c);
    return c.json(formatRole(role));
  });

  app.put(`${pathPrefix}/:slug`, async (c) => {
    const role = config.requireRole(ws, c);

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};
    if ('name' in body) updates.name = body.name;
    if ('description' in body) updates.description = body.description ?? null;
    if ('is_default_role' in body) updates.is_default_role = Boolean(body.is_default_role);
    if ('priority' in body) updates.priority = body.priority;

    const updated = ws.roles.update(role.id, updates);
    return c.json(formatRole(updated!));
  });

  app.delete(`${pathPrefix}/:slug`, (c) => {
    const role = config.requireRole(ws, c);

    ws.rolePermissions.deleteBy('role_id', role.id);
    ws.roleAssignments.deleteBy('role_id', role.id);

    ws.roles.delete(role.id);
    return c.body(null, 204);
  });

  // Role permissions management
  app.get(`${pathPrefix}/:slug/permissions`, (c) => {
    const role = config.requireRole(ws, c);
    const permissions = getRolePermissions(ws, role.id);

    return c.json({
      object: 'list',
      data: permissions.map((p) => formatPermission(p)),
      list_metadata: { before: null, after: null },
    });
  });

  app.post(`${pathPrefix}/:slug/permissions`, async (c) => {
    const role = config.requireRole(ws, c);

    const body = await parseJsonBody(c);
    const permissionSlugs = body.permissions as string[];
    if (!Array.isArray(permissionSlugs)) {
      throw validationError('permissions must be an array of slugs', [{ field: 'permissions', code: 'invalid' }]);
    }

    const permissions = replaceRolePermissions(ws, role.id, permissionSlugs);

    return c.json({
      object: 'list',
      data: permissions.map((p) => formatPermission(p)),
      list_metadata: { before: null, after: null },
    });
  });
}
