/**
 * API-key adapters for `workos role` and `workos permission`, backed by
 * `/authorization/roles`, `/authorization/organizations/{id}/roles` and
 * `/authorization/permissions`.
 *
 * The dashboard mutations are ID-keyed; REST is slug-keyed. The commands always
 * list the scope before mutating (to resolve the slug), so the list adapters
 * remember each role/permission's slug and scope by ID for the mutation that
 * follows in the same invocation.
 */

import { WorkOSApiError } from '../workos-api.js';
import { type ApiKeyContext, type ApiKeyOperation, encode, listAll, orNull } from './context.js';
import type { RestRole } from './lookups.js';

interface RestPermission {
  object?: 'permission';
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  system?: boolean;
  resource_type_slug?: string;
  created_at?: string;
  updated_at?: string;
}

interface RoleRef {
  slug: string;
  /** Set for organization (custom) roles. */
  organizationId?: string;
}

const roleRefs = new Map<string, RoleRef>();
const permissionSlugs = new Map<string, string>();

/** REST `EnvironmentRole`/`OrganizationRole` → the dashboard's `Environment`/`Organization`. */
function roleType(type: string | undefined): string | null {
  if (!type) return null;
  return type.endsWith('Role') ? type.slice(0, -'Role'.length) : type;
}

function roleNode(role: RestRole) {
  return {
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description ?? null,
    state: null,
    type: roleType(role.type),
    permissions: (role.permissions ?? []).map((slug) => ({ id: null, slug })),
    createdAt: role.created_at ?? null,
    updatedAt: role.updated_at ?? null,
  };
}

function rememberRoles(roles: RestRole[], organizationId?: string): RestRole[] {
  for (const role of roles) {
    const custom = organizationId !== undefined && roleType(role.type) === 'Organization';
    roleRefs.set(role.id, { slug: role.slug, ...(custom ? { organizationId } : {}) });
  }
  return roles;
}

function permissionNode(permission: RestPermission) {
  permissionSlugs.set(permission.id, permission.slug);
  return {
    id: permission.id,
    name: permission.name,
    slug: permission.slug,
    description: permission.description ?? null,
    system: permission.system ?? false,
    createdAt: permission.created_at ?? null,
    updatedAt: permission.updated_at ?? null,
  };
}

function rolePath(ref: RoleRef): string {
  return ref.organizationId
    ? `/authorization/organizations/${encode(ref.organizationId)}/roles/${encode(ref.slug)}`
    : `/authorization/roles/${encode(ref.slug)}`;
}

function isConflict(error: unknown): boolean {
  return (
    error instanceof WorkOSApiError &&
    (error.statusCode === 409 || (typeof error.code === 'string' && error.code.includes('already_exists')))
  );
}

async function readRole(ctx: ApiKeyContext, ref: RoleRef): Promise<RestRole | null> {
  return orNull(ctx.request<RestRole>({ method: 'GET', path: rolePath(ref) }));
}

export const rbacOperations: Record<string, ApiKeyOperation> = {
  async roles(_variables, ctx) {
    const result = await ctx.request<{ data: RestRole[] }>({ method: 'GET', path: '/authorization/roles' });
    return { rolesForEnvironment: { roles: rememberRoles(result?.data ?? []).map(roleNode) } };
  },

  async rolesForOrganization(variables, ctx) {
    const organizationId = String(variables.organizationId);
    const result = await orNull(
      ctx.request<{ data: RestRole[] }>({
        method: 'GET',
        path: `/authorization/organizations/${encode(organizationId)}/roles`,
      }),
    );
    if (!result) return { rolesForOrganization: null };
    return { rolesForOrganization: { roles: rememberRoles(result.data ?? [], organizationId).map(roleNode) } };
  },

  async createRole(variables, ctx) {
    const input = (variables.input ?? {}) as {
      slug?: string;
      name?: string;
      description?: string;
      organizationId?: string;
    };
    const path = input.organizationId
      ? `/authorization/organizations/${encode(input.organizationId)}/roles`
      : '/authorization/roles';
    try {
      const role = await ctx.request<RestRole>({
        method: 'POST',
        path,
        body: {
          slug: input.slug,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      return { createRole: { __typename: 'RoleCreated', role: roleNode(role) } };
    } catch (error) {
      if (isConflict(error)) return { createRole: { __typename: 'RoleAlreadyExists', slug: input.slug } };
      throw error;
    }
  },

  async updateRole(variables, ctx) {
    const input = (variables.input ?? {}) as {
      roleId?: string;
      name?: string;
      description?: string;
      permissions?: string[];
    };
    const ref = input.roleId ? roleRefs.get(input.roleId) : undefined;
    const notFound = { updateRole: { __typename: 'RoleNotFound', roleId: input.roleId } };
    if (!ref) return notFound;

    let role = await orNull(
      ctx.request<RestRole>({
        method: 'PATCH',
        path: rolePath(ref),
        body: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      }),
    );
    if (!role) return notFound;
    if (input.permissions) {
      role =
        (await orNull(
          ctx.request<RestRole>({
            method: 'PUT',
            path: `${rolePath(ref)}/permissions`,
            body: { permissions: input.permissions },
          }),
        )) ?? (await readRole(ctx, ref));
      if (!role) return notFound;
    }
    return { updateRole: { __typename: 'RoleUpdated', role: roleNode(role) } };
  },

  async deleteRole(variables, ctx) {
    const { roleId } = (variables.input ?? {}) as { roleId?: string };
    const ref = roleId ? roleRefs.get(roleId) : undefined;
    const deleted = ref && (await orNull(ctx.request({ method: 'DELETE', path: rolePath(ref) }).then(() => true)));
    return { deleteRole: deleted ? { __typename: 'RoleDeleted' } : { __typename: 'RoleNotFound', roleId } };
  },

  // --- permission ---------------------------------------------------------------

  async permissions(_variables, ctx) {
    // The dashboard returns the environment's whole permission set; REST pages it.
    const permissions = await listAll<RestPermission>(ctx, '/authorization/permissions');
    return { permissionsForEnvironment: { permissions: permissions.map(permissionNode) } };
  },

  async createPermission(variables, ctx) {
    const input = (variables.input ?? {}) as { slug?: string; name?: string; description?: string };
    try {
      const permission = await ctx.request<RestPermission>({
        method: 'POST',
        path: '/authorization/permissions',
        body: {
          slug: input.slug,
          name: input.name,
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      });
      return { createPermission: { __typename: 'PermissionCreated', permission: permissionNode(permission) } };
    } catch (error) {
      if (isConflict(error)) return { createPermission: { __typename: 'PermissionAlreadyExists', slug: input.slug } };
      throw error;
    }
  },

  async updatePermission(variables, ctx) {
    const input = (variables.input ?? {}) as { permissionId?: string; name?: string; description?: string };
    const slug = input.permissionId ? permissionSlugs.get(input.permissionId) : undefined;
    const permission =
      slug &&
      (await orNull(
        ctx.request<RestPermission>({
          method: 'PATCH',
          path: `/authorization/permissions/${encode(slug)}`,
          body: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
        }),
      ));
    return {
      updatePermission: permission
        ? { __typename: 'PermissionUpdated', permission: permissionNode(permission) }
        : { __typename: 'PermissionNotFound', permissionId: input.permissionId },
    };
  },

  async deletePermission(variables, ctx) {
    const { permissionId } = (variables.input ?? {}) as { permissionId?: string };
    const slug = permissionId ? permissionSlugs.get(permissionId) : undefined;
    const deleted =
      slug &&
      (await orNull(
        ctx.request({ method: 'DELETE', path: `/authorization/permissions/${encode(slug)}` }).then(() => true),
      ));
    return {
      deletePermission: deleted
        ? { __typename: 'PermissionDeleted', permissionId }
        : { __typename: 'PermissionNotFound', permissionId },
    };
  },
};
