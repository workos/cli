import type { RouteContext } from '../../core/index.js';
import { findEnvRole, requireEnvRole, registerRoleRoutes } from '../role-helpers.js';

export function authorizationRoleRoutes(ctx: RouteContext): void {
  registerRoleRoutes(ctx, {
    pathPrefix: '/authorization/roles',
    roleType: 'EnvironmentRole',
    requireRole: (ws, c) => requireEnvRole(ws, c.req.param('slug')!),
    findRole: (ws, _c, slug) => findEnvRole(ws, slug),
    listFilter: () => (r) => r.type === 'EnvironmentRole',
    insertDefaults: () => ({ organization_id: null }),
    duplicateMessage: 'Role with this slug already exists',
  });
}
