import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatRole, formatPermission, parseListParams } from '../helpers.js';

export function authorizationRoleRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  app.post('/authorization/roles', async (c) => {
    const ws = getWorkOSStore(store);
    const body = await parseJsonBody(c);
    const slug = body.slug as string;
    const name = body.name as string;

    if (!slug || typeof slug !== 'string') {
      throw validationError('slug is required', [{ field: 'slug', code: 'required' }]);
    }
    if (!name || typeof name !== 'string') {
      throw validationError('name is required', [{ field: 'name', code: 'required' }]);
    }

    // Check uniqueness among environment roles
    const existing = ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
    if (existing) {
      throw validationError('Role with this slug already exists', [{ field: 'slug', code: 'duplicate' }]);
    }

    const role = ws.roles.insert({
      object: 'role',
      slug,
      name,
      description: (body.description as string) ?? null,
      type: 'EnvironmentRole',
      organization_id: null,
      is_default_role: Boolean(body.is_default_role),
      priority: typeof body.priority === 'number' ? body.priority : 0,
    });

    return c.json(formatRole(role), 201);
  });

  app.get('/authorization/roles', (c) => {
    const ws = getWorkOSStore(store);
    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.roles.list({
      ...params,
      filter: (r) => r.type === 'EnvironmentRole',
    });

    return c.json({
      object: 'list',
      data: result.data.map(formatRole),
      list_metadata: result.list_metadata,
    });
  });

  app.get('/authorization/roles/:slug', (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const role = ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
    if (!role) throw notFound('Role');
    return c.json(formatRole(role));
  });

  app.put('/authorization/roles/:slug', async (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const role = ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
    if (!role) throw notFound('Role');

    const body = await parseJsonBody(c);
    const updates: Record<string, unknown> = {};
    if ('name' in body) updates.name = body.name;
    if ('description' in body) updates.description = body.description ?? null;
    if ('is_default_role' in body) updates.is_default_role = Boolean(body.is_default_role);
    if ('priority' in body) updates.priority = body.priority;

    const updated = ws.roles.update(role.id, updates);
    return c.json(formatRole(updated!));
  });

  app.delete('/authorization/roles/:slug', (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const role = ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
    if (!role) throw notFound('Role');

    // Cascade: remove role-permission joins and role assignments
    const rps = ws.rolePermissions.findBy('role_id', role.id);
    for (const rp of rps) ws.rolePermissions.delete(rp.id);
    const ras = ws.roleAssignments.findBy('role_id', role.id);
    for (const ra of ras) ws.roleAssignments.delete(ra.id);

    ws.roles.delete(role.id);
    return c.body(null, 204);
  });

  // Role permissions management
  app.get('/authorization/roles/:slug/permissions', (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const role = ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
    if (!role) throw notFound('Role');

    const rps = ws.rolePermissions.findBy('role_id', role.id);
    const permissions = rps.map((rp) => ws.permissions.get(rp.permission_id)).filter(Boolean);

    return c.json({
      object: 'list',
      data: permissions.map((p) => formatPermission(p!)),
      list_metadata: { before: null, after: null },
    });
  });

  app.post('/authorization/roles/:slug/permissions', async (c) => {
    const ws = getWorkOSStore(store);
    const slug = c.req.param('slug');
    const role = ws.roles.findBy('slug', slug).find((r) => r.type === 'EnvironmentRole');
    if (!role) throw notFound('Role');

    const body = await parseJsonBody(c);
    const permissionSlugs = body.permissions as string[];
    if (!Array.isArray(permissionSlugs)) {
      throw validationError('permissions must be an array of slugs', [{ field: 'permissions', code: 'invalid' }]);
    }

    // Replace all: delete existing, add new
    const existing = ws.rolePermissions.findBy('role_id', role.id);
    for (const rp of existing) ws.rolePermissions.delete(rp.id);

    for (const permSlug of permissionSlugs) {
      const perm = ws.permissions.findOneBy('slug', permSlug);
      if (!perm) throw notFound('Permission');
      ws.rolePermissions.insert({ role_id: role.id, permission_id: perm.id });
    }

    const rps = ws.rolePermissions.findBy('role_id', role.id);
    const permissions = rps.map((rp) => ws.permissions.get(rp.permission_id)).filter(Boolean);

    return c.json({
      object: 'list',
      data: permissions.map((p) => formatPermission(p!)),
      list_metadata: { before: null, after: null },
    });
  });
}
