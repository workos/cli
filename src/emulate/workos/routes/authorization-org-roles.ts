import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatRole, formatPermission, parseListParams } from '../helpers.js';

export function authorizationOrgRoleRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  app.post('/authorization/organizations/:orgId/roles', async (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const org = ws.organizations.get(orgId);
    if (!org) throw notFound('Organization');

    const body = await parseJsonBody(c);
    const slug = body.slug as string;
    const name = body.name as string;

    if (!slug || typeof slug !== 'string') {
      throw validationError('slug is required', [{ field: 'slug', code: 'required' }]);
    }
    if (!name || typeof name !== 'string') {
      throw validationError('name is required', [{ field: 'name', code: 'required' }]);
    }

    // Check uniqueness within this org
    const existing = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
    if (existing) {
      throw validationError('Role with this slug already exists in this organization', [
        { field: 'slug', code: 'duplicate' },
      ]);
    }

    const role = ws.roles.insert({
      object: 'role',
      slug,
      name,
      description: (body.description as string) ?? null,
      type: 'OrganizationRole',
      organization_id: orgId,
      is_default_role: Boolean(body.is_default_role),
      priority: typeof body.priority === 'number' ? body.priority : 0,
    });

    return c.json(formatRole(role), 201);
  });

  app.get('/authorization/organizations/:orgId/roles', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.roles.list({
      ...params,
      filter: (r) => r.organization_id === orgId && r.type === 'OrganizationRole',
    });

    return c.json({
      object: 'list',
      data: result.data.map(formatRole),
      list_metadata: result.list_metadata,
    });
  });

  // Priority ordering — must be registered before :slug routes
  app.put('/authorization/organizations/:orgId/roles/priority', async (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const body = await parseJsonBody(c);
    const slugs = body.slugs as string[];

    if (!Array.isArray(slugs)) {
      throw validationError('slugs must be an array', [{ field: 'slugs', code: 'invalid' }]);
    }

    for (let i = 0; i < slugs.length; i++) {
      const role = ws.roles
        .findBy('organization_id', orgId)
        .find((r) => r.slug === slugs[i] && r.type === 'OrganizationRole');
      if (!role) throw notFound('Role');
      ws.roles.update(role.id, { priority: i });
    }

    const roles = ws.roles
      .findBy('organization_id', orgId)
      .filter((r) => r.type === 'OrganizationRole')
      .sort((a, b) => a.priority - b.priority);

    return c.json({
      object: 'list',
      data: roles.map(formatRole),
      list_metadata: { before: null, after: null },
    });
  });

  app.get('/authorization/organizations/:orgId/roles/:slug', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const slug = c.req.param('slug');
    const role = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
    if (!role) throw notFound('Role');
    return c.json(formatRole(role));
  });

  app.put('/authorization/organizations/:orgId/roles/:slug', async (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const slug = c.req.param('slug');
    const role = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
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

  app.delete('/authorization/organizations/:orgId/roles/:slug', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const slug = c.req.param('slug');
    const role = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
    if (!role) throw notFound('Role');

    // Cascade: remove role-permission joins and role assignments
    const rps = ws.rolePermissions.findBy('role_id', role.id);
    for (const rp of rps) ws.rolePermissions.delete(rp.id);
    const ras = ws.roleAssignments.findBy('role_id', role.id);
    for (const ra of ras) ws.roleAssignments.delete(ra.id);

    ws.roles.delete(role.id);
    return c.body(null, 204);
  });

  // Org role permissions
  app.get('/authorization/organizations/:orgId/roles/:slug/permissions', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const slug = c.req.param('slug');
    const role = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
    if (!role) throw notFound('Role');

    const rps = ws.rolePermissions.findBy('role_id', role.id);
    const permissions = rps.map((rp) => ws.permissions.get(rp.permission_id)).filter(Boolean);

    return c.json({
      object: 'list',
      data: permissions.map((p) => formatPermission(p!)),
      list_metadata: { before: null, after: null },
    });
  });

  app.post('/authorization/organizations/:orgId/roles/:slug/permissions', async (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const slug = c.req.param('slug');
    const role = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
    if (!role) throw notFound('Role');

    const body = await parseJsonBody(c);
    const permissionSlugs = body.permissions as string[];
    if (!Array.isArray(permissionSlugs)) {
      throw validationError('permissions must be an array of slugs', [{ field: 'permissions', code: 'invalid' }]);
    }

    // Replace all
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

  app.delete('/authorization/organizations/:orgId/roles/:slug/permissions/:permissionSlug', (c) => {
    const ws = getWorkOSStore(store);
    const orgId = c.req.param('orgId');
    const slug = c.req.param('slug');
    const permissionSlug = c.req.param('permissionSlug');

    const role = ws.roles
      .findBy('organization_id', orgId)
      .find((r) => r.slug === slug && r.type === 'OrganizationRole');
    if (!role) throw notFound('Role');

    const perm = ws.permissions.findOneBy('slug', permissionSlug);
    if (!perm) throw notFound('Permission');

    const rp = ws.rolePermissions.findBy('role_id', role.id).find((rp) => rp.permission_id === perm.id);
    if (!rp) throw notFound('RolePermission');

    ws.rolePermissions.delete(rp.id);
    return c.body(null, 204);
  });
}
