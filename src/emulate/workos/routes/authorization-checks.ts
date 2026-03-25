import { type RouteContext, notFound, validationError, parseJsonBody } from '../../core/index.js';
import { getWorkOSStore } from '../store.js';
import { formatRoleAssignment, formatAuthorizationResource, parseListParams } from '../helpers.js';

/**
 * Gather all permission slugs for a given membership:
 * 1. From the membership's role (role.slug field)
 * 2. From any additional role assignments
 */
function getPermissionsForMembership(ws: ReturnType<typeof getWorkOSStore>, membershipId: string): Set<string> {
  const membership = ws.organizationMemberships.get(membershipId);
  if (!membership) return new Set();

  const permSlugs = new Set<string>();

  // Permissions from the membership's primary role
  const primaryRole = ws.roles
    .findBy('slug', membership.role.slug)
    .find((r) => r.organization_id === membership.organization_id || r.type === 'EnvironmentRole');
  if (primaryRole) {
    const rps = ws.rolePermissions.findBy('role_id', primaryRole.id);
    for (const rp of rps) {
      const perm = ws.permissions.get(rp.permission_id);
      if (perm) permSlugs.add(perm.slug);
    }
  }

  // Permissions from additional role assignments
  const assignments = ws.roleAssignments.findBy('organization_membership_id', membershipId);
  for (const assignment of assignments) {
    const role = ws.roles.get(assignment.role_id);
    if (!role) continue;
    const rps = ws.rolePermissions.findBy('role_id', role.id);
    for (const rp of rps) {
      const perm = ws.permissions.get(rp.permission_id);
      if (perm) permSlugs.add(perm.slug);
    }
  }

  return permSlugs;
}

export function authorizationCheckRoutes(ctx: RouteContext): void {
  const { app, store } = ctx;

  // Permission check
  app.post('/authorization/organization_memberships/:id/check', async (c) => {
    const ws = getWorkOSStore(store);
    const membershipId = c.req.param('id');
    const membership = ws.organizationMemberships.get(membershipId);
    if (!membership) throw notFound('OrganizationMembership');

    const body = await parseJsonBody(c);
    const permission = body.permission as string;
    if (!permission) {
      throw validationError('permission is required', [{ field: 'permission', code: 'required' }]);
    }

    const permSlugs = getPermissionsForMembership(ws, membershipId);
    return c.json({ authorized: permSlugs.has(permission) });
  });

  // List resources accessible to a membership (all resources in the membership's org)
  app.get('/authorization/organization_memberships/:id/resources', (c) => {
    const ws = getWorkOSStore(store);
    const membershipId = c.req.param('id');
    const membership = ws.organizationMemberships.get(membershipId);
    if (!membership) throw notFound('OrganizationMembership');

    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.authorizationResources.list({
      ...params,
      filter: (r) => r.organization_id === membership.organization_id,
    });

    return c.json({
      object: 'list',
      data: result.data.map(formatAuthorizationResource),
      list_metadata: result.list_metadata,
    });
  });

  // List role assignments for a membership
  app.get('/authorization/organization_memberships/:id/role_assignments', (c) => {
    const ws = getWorkOSStore(store);
    const membershipId = c.req.param('id');
    const membership = ws.organizationMemberships.get(membershipId);
    if (!membership) throw notFound('OrganizationMembership');

    const url = new URL(c.req.url);
    const params = parseListParams(url);

    const result = ws.roleAssignments.list({
      ...params,
      filter: (ra) => ra.organization_membership_id === membershipId,
    });

    return c.json({
      object: 'list',
      data: result.data.map(formatRoleAssignment),
      list_metadata: result.list_metadata,
    });
  });

  // Create role assignment
  app.post('/authorization/organization_memberships/:id/role_assignments', async (c) => {
    const ws = getWorkOSStore(store);
    const membershipId = c.req.param('id');
    const membership = ws.organizationMemberships.get(membershipId);
    if (!membership) throw notFound('OrganizationMembership');

    const body = await parseJsonBody(c);
    const roleId = body.role_id as string;
    if (!roleId) {
      throw validationError('role_id is required', [{ field: 'role_id', code: 'required' }]);
    }

    const role = ws.roles.get(roleId);
    if (!role) throw notFound('Role');

    const assignment = ws.roleAssignments.insert({
      object: 'role_assignment',
      organization_membership_id: membershipId,
      role_id: roleId,
    });

    return c.json(formatRoleAssignment(assignment), 201);
  });

  // Delete role assignment
  app.delete('/authorization/organization_memberships/:id/role_assignments/:assignmentId', (c) => {
    const ws = getWorkOSStore(store);
    const membershipId = c.req.param('id');
    const assignmentId = c.req.param('assignmentId');

    const membership = ws.organizationMemberships.get(membershipId);
    if (!membership) throw notFound('OrganizationMembership');

    const assignment = ws.roleAssignments.get(assignmentId);
    if (!assignment || assignment.organization_membership_id !== membershipId) {
      throw notFound('RoleAssignment');
    }

    ws.roleAssignments.delete(assignmentId);
    return c.body(null, 204);
  });
}

export { getPermissionsForMembership };
