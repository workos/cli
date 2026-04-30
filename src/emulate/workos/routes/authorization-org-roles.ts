import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatRole } from '../helpers.js';
import { findOrgRole, requireOrgRole, registerRoleRoutes } from '../role-helpers.js';

export function authorizationOrgRoleRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;
  const ws = getWorkOSStore(store);
  const prefix = '/authorization/organizations/:orgId/roles';

  // Priority ordering — must be registered before :slug routes
  app.put(`${prefix}/priority`, async (c) => {
    const orgId = c.req.param('orgId');
    const body = await parseJsonBody(c);
    const slugs = body.slugs as string[];

    if (!Array.isArray(slugs)) {
      throw validationError('slugs must be an array', [{ field: 'slugs', code: 'invalid' }]);
    }

    // Fetch once, build slug map for O(1) lookups
    const orgRoles = ws.roles.findBy('organization_id', orgId).filter((r) => r.type === 'OrganizationRole');
    const rolesBySlug = new Map(orgRoles.map((r) => [r.slug, r]));

    for (let i = 0; i < slugs.length; i++) {
      const role = rolesBySlug.get(slugs[i]!);
      if (!role) throw notFound('Role');
      ws.roles.update(role.id, { priority: i });
    }

    // Re-fetch for updated priority values
    const updated = ws.roles
      .findBy('organization_id', orgId)
      .filter((r) => r.type === 'OrganizationRole')
      .sort((a, b) => a.priority - b.priority);

    return c.json({
      object: 'list',
      data: updated.map(formatRole),
      list_metadata: { before: null, after: null },
    });
  });

  registerRoleRoutes(ctx, {
    pathPrefix: prefix,
    roleType: 'OrganizationRole',
    requireRole: (ws, c) => requireOrgRole(ws, c.req.param('orgId')!, c.req.param('slug')!),
    findRole: (ws, c, slug) => findOrgRole(ws, c.req.param('orgId')!, slug),
    listFilter: (c) => (r) => r.organization_id === c.req.param('orgId')! && r.type === 'OrganizationRole',
    insertDefaults: (c) => ({ organization_id: c.req.param('orgId')! }),
    duplicateMessage: 'Role with this slug already exists in this organization',
    validateBeforeCreate: (ws, c) => {
      const org = ws.organizations.get(c.req.param('orgId')!);
      if (!org) throw notFound('Organization');
    },
  });

  // Org-specific: delete single permission from role
  app.delete(`${prefix}/:slug/permissions/:permissionSlug`, (c) => {
    const role = requireOrgRole(ws, c.req.param('orgId'), c.req.param('slug'));

    const perm = ws.permissions.findOneBy('slug', c.req.param('permissionSlug'));
    if (!perm) throw notFound('Permission');

    const rp = ws.rolePermissions.findBy('role_id', role.id).find((rp) => rp.permission_id === perm.id);
    if (!rp) throw notFound('RolePermission');

    ws.rolePermissions.delete(rp.id);
    return c.body(null, 204);
  });
}
