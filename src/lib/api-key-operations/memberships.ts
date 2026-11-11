/**
 * API-key adapters for `workos membership` and `workos invitation`, backed by
 * `/user_management/organization_memberships` and `/user_management/invitations`.
 *
 * The CLI takes role IDs (`role_*`) for `--role`; REST takes role slugs, so the
 * ID is resolved through the roles endpoints first. A membership's `type` and
 * `directoryUserId` have no REST source and come back `null`.
 */

import type { WorkOSListResponse } from '../workos-api.js';
import {
  type ApiKeyContext,
  type ApiKeyOperation,
  encode,
  listEnvelope,
  num,
  orNull,
  restOrder,
  str,
} from './context.js';
import {
  ALL_MEMBERSHIP_STATUSES,
  findRole,
  membershipsForUser,
  organizationName,
  type RestMembership,
} from './lookups.js';
import { exitWithError } from '../../utils/output.js';

interface RestInvitation {
  object?: 'invitation';
  id: string;
  email: string;
  state?: string | null;
  organization_id?: string | null;
  created_at?: string;
}

function membershipNode(membership: RestMembership) {
  return {
    id: membership.id,
    type: null,
    status: membership.status ?? null,
    organizationId: membership.organization_id ?? null,
    userlandUserId: membership.user_id ?? null,
    directoryUserId: null,
    role: membership.role ?? null,
    roles: membership.roles ?? [],
    createdAt: membership.created_at ?? null,
    updatedAt: membership.updated_at ?? null,
  };
}

/**
 * Membership IDs this invocation has already resolved, keyed by organization +
 * user. `membership delete <id>` reads the membership first (the dashboard
 * removal is keyed by organization + user), so the removal can delete that
 * exact ID instead of searching again.
 */
const resolvedMembershipIds = new Map<string, string>();
const membershipKey = (organizationId: unknown, userId: unknown) => `${String(organizationId)}\u0000${String(userId)}`;

async function readMembership(ctx: ApiKeyContext, id: string): Promise<RestMembership | null> {
  const membership = await orNull(
    ctx.request<RestMembership>({ method: 'GET', path: `/user_management/organization_memberships/${encode(id)}` }),
  );
  if (membership)
    resolvedMembershipIds.set(membershipKey(membership.organization_id, membership.user_id), membership.id);
  return membership;
}

async function organizationExists(ctx: ApiKeyContext, organizationId: string): Promise<boolean> {
  const org = await orNull(ctx.request({ method: 'GET', path: `/organizations/${encode(organizationId)}` }));
  return org !== null;
}

/** A role ID → its slug, searching the environment roles, then the organization's. */
async function roleSlug(ctx: ApiKeyContext, roleId: string, organizationId?: string | null) {
  return (await findRole(ctx, { id: roleId }, organizationId))?.slug;
}

async function invitationNode(ctx: ApiKeyContext, invitation: RestInvitation) {
  return {
    __typename: 'UserlandUserInvite',
    id: invitation.id,
    createdAt: invitation.created_at ?? null,
    inviteeEmail: invitation.email ?? null,
    state: invitation.state ?? null,
    organization: invitation.organization_id
      ? { id: invitation.organization_id, name: await organizationName(ctx, invitation.organization_id) }
      : null,
  };
}

function listInvitations(ctx: ApiKeyContext, variables: Record<string, unknown>, organizationId?: string) {
  return ctx.request<WorkOSListResponse<RestInvitation>>({
    method: 'GET',
    path: '/user_management/invitations',
    params: {
      limit: num(variables.limit),
      before: str(variables.before),
      after: str(variables.after),
      // `--email` is the CLI's only search input; REST filters by exact email.
      email: str(variables.search),
      organization_id: organizationId,
      order: restOrder(),
    },
  });
}

/** Membership state change endpoints share one not-found contract. */
async function setMembershipState(ctx: ApiKeyContext, id: unknown, action: 'deactivate' | 'reactivate') {
  const result = await orNull(
    ctx
      .request({ method: 'PUT', path: `/user_management/organization_memberships/${encode(String(id))}/${action}` })
      .then(() => true),
  );
  return result
    ? `UserlandUserOrganizationMembership${action === 'deactivate' ? 'Deactivated' : 'Reactivated'}`
    : 'UserlandUserOrganizationMembershipNotFound';
}

export const membershipOperations: Record<string, ApiKeyOperation> = {
  async userlandUserOrganizationMemberships(variables, ctx) {
    const memberships = await membershipsForUser(ctx, String(variables.userlandUserId));
    return { userlandUserOrganizationMemberships: { organizationMemberships: memberships.map(membershipNode) } };
  },

  async userlandUsersByOrg(variables, ctx) {
    const organizationId = String(variables.organizationId);
    if (!(await organizationExists(ctx, organizationId))) return { organization: null };
    // REST pages the organization's memberships directly (cursors are
    // membership IDs); each becomes a user entry carrying that one identity.
    const page = await ctx.request<WorkOSListResponse<RestMembership>>({
      method: 'GET',
      path: '/user_management/organization_memberships',
      params: {
        organization_id: organizationId,
        statuses: ALL_MEMBERSHIP_STATUSES,
        limit: num(variables.limit),
        before: str(variables.before),
        after: str(variables.after),
        order: restOrder(variables.order),
      },
    });
    const users = (page?.data ?? []).map((membership) => ({
      id: membership.user_id,
      identities: {
        data: [
          {
            id: membership.id,
            status: membership.status ?? null,
            directoryUserId: null,
            role: membership.role ?? null,
            roles: membership.roles ?? [],
            organization: { id: organizationId, name: membership.organization_name ?? null },
            createdAt: membership.created_at ?? null,
            updatedAt: membership.updated_at ?? null,
          },
        ],
      },
    }));
    return { organization: { userlandUsers: listEnvelope(users, page?.list_metadata) } };
  },

  async userlandUserOrganizationMembership(variables, ctx) {
    const membership = await readMembership(ctx, String(variables.id));
    return { userlandUserOrganizationMembership: membership ? membershipNode(membership) : null };
  },

  async addUserlandUserToOrg(variables, ctx) {
    const input = (variables.input ?? {}) as { organizationId?: string; userlandUserId?: string; roleId?: string };
    let slug: string | undefined;
    if (input.roleId) {
      slug = await roleSlug(ctx, input.roleId, input.organizationId);
      if (!slug) return roleNotFound(input.roleId);
    }
    await ctx.request({
      method: 'POST',
      path: '/user_management/organization_memberships',
      body: {
        organization_id: input.organizationId,
        user_id: input.userlandUserId,
        ...(slug ? { role_slug: slug } : {}),
      },
    });
    return { addUserlandUserToOrganization: { __typename: 'UserlandUserAddedToOrganization' } };
  },

  async updateRoleOnOrganizationMembership(variables, ctx) {
    const input = (variables.input ?? {}) as { organizationMembershipId?: string; roleId?: string };
    const notFound = {
      updateRoleOnOrganizationMembership: { __typename: 'UserlandUserOrganizationMembershipNotFound', message: '' },
    };
    const current = await readMembership(ctx, String(input.organizationMembershipId));
    if (!current) return notFound;
    const slug = await roleSlug(ctx, String(input.roleId), current.organization_id);
    if (!slug) {
      return { updateRoleOnOrganizationMembership: { __typename: 'RoleNotFound', roleId: input.roleId } };
    }
    const updated = await orNull(
      ctx.request<RestMembership>({
        method: 'PUT',
        path: `/user_management/organization_memberships/${encode(current.id)}`,
        body: { role_slug: slug },
      }),
    );
    if (!updated) return notFound;
    return {
      updateRoleOnOrganizationMembership: {
        __typename: 'RoleOnOrganizationMembershipUpdated',
        organizationMembership: membershipNode(updated),
      },
    };
  },

  async removeMemberFromOrganization(variables, ctx) {
    const input = (variables.input ?? {}) as { organizationId?: string; userlandUserId?: string };
    // REST deletes by membership ID. Use the one this invocation already
    // resolved; otherwise search the pair across every status (an inactive
    // membership must still be deletable).
    let membershipId = resolvedMembershipIds.get(membershipKey(input.organizationId, input.userlandUserId));
    if (!membershipId) {
      const page = await ctx.request<WorkOSListResponse<RestMembership>>({
        method: 'GET',
        path: '/user_management/organization_memberships',
        params: {
          organization_id: input.organizationId,
          user_id: input.userlandUserId,
          statuses: ALL_MEMBERSHIP_STATUSES,
          limit: 1,
        },
      });
      membershipId = page?.data?.[0]?.id;
    }
    const removed =
      membershipId &&
      (await orNull(
        ctx
          .request({ method: 'DELETE', path: `/user_management/organization_memberships/${encode(membershipId)}` })
          .then(() => true),
      ));
    return {
      removeUserlandUserFromOrganization: {
        __typename: removed ? 'UserlandUserRemovedFromOrganization' : 'UserlandUserOrganizationMembershipNotFound',
      },
    };
  },

  async deactivateOrganizationMembership(variables, ctx) {
    const { userlandUserOrganizationMembershipId: id } = (variables.input ?? {}) as Record<string, unknown>;
    return {
      deactivateUserlandUserOrganizationMembership: { __typename: await setMembershipState(ctx, id, 'deactivate') },
    };
  },

  async reactivateOrganizationMembership(variables, ctx) {
    const { userlandUserOrganizationMembershipId: id } = (variables.input ?? {}) as Record<string, unknown>;
    return {
      reactivateUserlandUserOrganizationMembership: { __typename: await setMembershipState(ctx, id, 'reactivate') },
    };
  },

  // --- invitation ---------------------------------------------------------------

  async userlandUserInvites(variables, ctx) {
    const page = await listInvitations(ctx, variables);
    const invitations = await Promise.all((page?.data ?? []).map((invitation) => invitationNode(ctx, invitation)));
    return { userlandUserInvites: listEnvelope(invitations, page?.list_metadata) };
  },

  async userlandUserInvitesByOrg(variables, ctx) {
    const organizationId = String(variables.organizationId);
    if (!(await organizationExists(ctx, organizationId))) return { organization: null };
    const page = await listInvitations(ctx, variables, organizationId);
    // The by-org selection carries no per-invite organization.
    const invitations = (page?.data ?? []).map((invitation) => ({
      __typename: 'UserlandUserInvite',
      id: invitation.id,
      createdAt: invitation.created_at ?? null,
      inviteeEmail: invitation.email ?? null,
      state: invitation.state ?? null,
    }));
    return { organization: { userlandUserInvites: listEnvelope(invitations, page?.list_metadata) } };
  },

  async createUserlandUserInvite(variables, ctx) {
    const input = (variables.input ?? {}) as {
      inviteeEmail?: string;
      expiresInDays?: number;
      organizationId?: string;
      roleId?: string;
    };
    let slug: string | undefined;
    if (input.roleId) {
      slug = await roleSlug(ctx, input.roleId, input.organizationId);
      if (!slug) return { createUserlandUserInvite: { __typename: 'CreateUserlandUserInviteInvalidRole' } };
    }
    const invitation = await ctx.request<RestInvitation>({
      method: 'POST',
      path: '/user_management/invitations',
      body: {
        email: input.inviteeEmail,
        ...(input.expiresInDays !== undefined ? { expires_in_days: input.expiresInDays } : {}),
        ...(input.organizationId ? { organization_id: input.organizationId } : {}),
        ...(slug ? { role_slug: slug } : {}),
      },
    });
    return {
      createUserlandUserInvite: { __typename: 'UserlandUserInviteCreated', userlandUserInvite: { id: invitation.id } },
    };
  },

  async revokeUserlandUserInvite(variables, ctx) {
    const { userlandUserInviteId: id } = (variables.input ?? {}) as { userlandUserInviteId?: string };
    const invitation = await orNull(
      ctx.request<RestInvitation>({
        method: 'POST',
        path: `/user_management/invitations/${encode(String(id))}/revoke`,
      }),
    );
    return {
      revokeUserlandUserInvite: invitation
        ? { __typename: 'UserlandUserInviteRevoked', userlandUserInvite: { id: invitation.id ?? id } }
        : { __typename: 'UserlandUserInviteNotFound' },
    };
  },

  async resendUserlandUserInvite(variables, ctx) {
    const { userlandUserInviteId: id } = (variables.input ?? {}) as { userlandUserInviteId?: string };
    const invitation = await orNull(
      ctx.request<RestInvitation>({
        method: 'POST',
        path: `/user_management/invitations/${encode(String(id))}/resend`,
      }),
    );
    return {
      resendUserlandUserInvite: invitation
        ? { __typename: 'UserlandUserInviteResent', userlandUserInvite: { id: invitation.id ?? id } }
        : { __typename: 'UserlandUserInviteNotFound' },
    };
  },
};

/** The add operation has no role-not-found result, so report it directly. */
function roleNotFound(roleId: string): never {
  exitWithError({ code: 'not_found', message: `Role "${roleId}" was not found in this environment.` });
}
