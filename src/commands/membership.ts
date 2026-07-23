/**
 * `workos membership` — organization-membership lifecycle on the dashboard
 * account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 4): the
 * subcommand surface (list/get/create/update/delete/deactivate/reactivate) is
 * unchanged, but every operation now runs catalog-backed dashboard operations
 * with the user's OAuth bearer. Output shapes are new curated shapes (approved
 * breaking change); the authoritative examples live in `membership.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `list` is backed by two operations: the by-user operation filters only by
 *   user and has no pagination; the by-org path supports pagination and
 *   ordering. Combining `--org` and `--user` is no longer supported.
 * - `delete <id>` is keyed server-side by organization + user, so the handler
 *   first resolves the membership by ID (one extra read) to preserve the
 *   frozen `delete <membershipId>` grammar.
 * - `--role` takes a role ID (role_*), not a role slug.
 *
 * Safety posture per the manifest: `delete` is destructive →
 * `confirmDestructive` (prompt, or --yes); `update` (privilege change) and
 * `deactivate` (access removal) are `require-flag` → non-interactive callers
 * must pass --yes.
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation } from '../catalog/operation.js';
import { runEnvScopedOperation, executeDashboardOperation } from '../lib/dashboard-operation.js';
import { confirmDestructive, requireConfirmationFlag } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';
import { normalizeOrder, printDetailFields, printPaginationFooter } from '../utils/resource-command.js';

/**
 * `role`/`roles` come back as unselected scalars on the membership record but
 * as `{ id, name }` objects on the by-org identity path — normalize both to a
 * plain string so the curated shape is stable.
 */
function normalizeRoleValue(role: unknown): string | null {
  if (role == null) return null;
  if (typeof role === 'string') return role;
  if (typeof role === 'object') {
    const candidate = role as { slug?: unknown; name?: unknown; id?: unknown };
    for (const key of ['slug', 'name', 'id'] as const) {
      if (typeof candidate[key] === 'string') return candidate[key] as string;
    }
  }
  return null;
}

function normalizeRolesValue(roles: unknown): string[] {
  if (!Array.isArray(roles)) return [];
  return roles.map(normalizeRoleValue).filter((role): role is string => role !== null);
}

interface MembershipNode {
  id: string;
  type?: string | null;
  status?: string | null;
  organizationId?: string | null;
  userlandUserId?: string | null;
  directoryUserId?: string | null;
  role?: unknown;
  roles?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * The curated membership shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see membership.spec.ts for the
 * authoritative example.
 */
function shapeMembership(membership: MembershipNode) {
  return {
    id: membership.id,
    userId: membership.userlandUserId ?? null,
    organizationId: membership.organizationId ?? null,
    status: membership.status ?? null,
    type: membership.type ?? null,
    role: normalizeRoleValue(membership.role),
    roles: normalizeRolesValue(membership.roles),
    directoryUserId: membership.directoryUserId ?? null,
    createdAt: membership.createdAt ?? null,
    updatedAt: membership.updatedAt ?? null,
  };
}

type ShapedMembership = ReturnType<typeof shapeMembership>;

function renderMembershipTable(memberships: ShapedMembership[]): void {
  const rows = memberships.map((m) => [
    m.id,
    m.userId ?? chalk.dim('-'),
    m.organizationId ?? chalk.dim('-'),
    m.role ?? (m.roles.length > 0 ? m.roles.join(', ') : chalk.dim('-')),
    m.status ?? chalk.dim('-'),
    m.createdAt ?? chalk.dim('-'),
  ]);
  console.log(
    formatTable(
      [
        { header: 'ID' },
        { header: 'User ID' },
        { header: 'Org ID' },
        { header: 'Role' },
        { header: 'Status' },
        { header: 'Created' },
      ],
      rows,
    ),
  );
}

export interface MembershipListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  org?: string;
  user?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

interface IdentityNode {
  id: string;
  status?: string | null;
  directoryUserId?: string | null;
  role?: unknown;
  roles?: unknown;
  organization?: { id: string; name: string | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export async function runMembershipList(options: MembershipListOptions = {}): Promise<void> {
  if (!options.org && !options.user) {
    exitWithError({
      code: 'missing_argument',
      message: 'One of --org or --user is required.',
    });
  }
  if (options.org && options.user) {
    exitWithError({
      code: 'invalid_argument',
      message: 'Pass either --org or --user, not both.',
    });
  }

  if (options.user) {
    // The by-user operation supports no pagination or ordering — refuse the
    // flags loudly rather than silently ignoring them.
    const unsupported = (['limit', 'before', 'after', 'order'] as const).filter((flag) => options[flag] !== undefined);
    if (unsupported.length > 0) {
      exitWithError({
        code: 'invalid_argument',
        message: `${unsupported.map((flag) => `--${flag}`).join(', ')} ${
          unsupported.length === 1 ? 'is' : 'are'
        } only supported with --org. Listing by user returns all memberships.`,
      });
    }
    await listMembershipsByUser(options.user, options);
    return;
  }

  await listMembershipsByOrg(options.org as string, options);
}

async function listMembershipsByUser(userId: string, options: MembershipListOptions): Promise<void> {
  // Environment-scoped read: the op takes only the user ID, but the target
  // still rides as the environment header.
  const { data } = await runEnvScopedOperation<{
    userlandUserOrganizationMemberships: { organizationMemberships: MembershipNode[] } | null;
  }>('userlandUserOrganizationMemberships', options, { userlandUserId: userId });

  const memberships = (data.userlandUserOrganizationMemberships?.organizationMemberships ?? []).map(shapeMembership);

  if (isJsonMode()) {
    outputJson({ memberships, pagination: { before: null, after: null } });
    return;
  }
  if (memberships.length === 0) {
    console.log('No memberships found.');
    return;
  }
  renderMembershipTable(memberships);
}

async function listMembershipsByOrg(orgId: string, options: MembershipListOptions): Promise<void> {
  const order = normalizeOrder(options.order);
  const { data } = await runEnvScopedOperation<{
    organization: {
      userlandUsers: {
        data: Array<{ id: string; identities?: { data: IdentityNode[] } | null }>;
        listMetadata: { before: string | null; after: string | null };
      } | null;
    } | null;
  }>('userlandUsersByOrg', options, {
    organizationId: orgId,
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.before ? { before: options.before } : {}),
    ...(options.after ? { after: options.after } : {}),
    ...(order ? { order } : {}),
  });

  if (!data.organization) {
    exitWithError({ code: 'not_found', message: `Organization "${orgId}" was not found in this environment.` });
  }

  // The by-org path returns the organization's users, each carrying its
  // org-filtered membership records (identities) — flatten those into the same
  // curated membership shape as the by-user path.
  const users = data.organization.userlandUsers?.data ?? [];
  const memberships = users.flatMap((user) =>
    (user.identities?.data ?? []).map((identity) =>
      shapeMembership({
        id: identity.id,
        status: identity.status,
        organizationId: identity.organization?.id ?? orgId,
        userlandUserId: user.id,
        directoryUserId: identity.directoryUserId,
        role: identity.role,
        roles: identity.roles,
        createdAt: identity.createdAt,
        updatedAt: identity.updatedAt,
      }),
    ),
  );
  const pagination = {
    before: data.organization.userlandUsers?.listMetadata?.before ?? null,
    after: data.organization.userlandUsers?.listMetadata?.after ?? null,
  };

  if (isJsonMode()) {
    outputJson({ memberships, pagination });
    return;
  }
  if (memberships.length === 0) {
    console.log('No memberships found.');
    return;
  }
  renderMembershipTable(memberships);
  printPaginationFooter(pagination);
}

export interface MembershipGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runMembershipGet(id: string, options: MembershipGetOptions = {}): Promise<void> {
  const { data } = await runEnvScopedOperation<{ userlandUserOrganizationMembership: MembershipNode | null }>(
    'userlandUserOrganizationMembership',
    options,
    { id },
  );

  if (!data.userlandUserOrganizationMembership) {
    exitWithError({ code: 'not_found', message: `Membership "${id}" was not found in this environment.` });
  }

  const membership = shapeMembership(data.userlandUserOrganizationMembership);
  if (isJsonMode()) {
    outputJson({ membership });
    return;
  }

  const fields: Array<[string, unknown]> = [
    ['ID', membership.id],
    ['User ID', membership.userId],
    ['Org ID', membership.organizationId],
    ['Role', membership.role ?? (membership.roles.length > 0 ? membership.roles.join(', ') : null)],
    ['Status', membership.status],
    ['Created', membership.createdAt],
  ];
  printDetailFields(fields);
}

export interface MembershipCreateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  org: string;
  user: string;
  /** Role ID (role_*) to assign on the new membership. */
  role?: string;
}

export async function runMembershipCreate(options: MembershipCreateOptions): Promise<void> {
  // Environment-scoped mutation: pre-validated resolved target as header.
  const { data } = await runEnvScopedOperation<{
    addUserlandUserToOrganization:
      | { __typename: 'UserlandUserAddedToOrganization' }
      | { __typename: 'OrganizationNotFound'; organizationId: string }
      | { __typename: 'UserlandUserNotFound'; userlandUserId: string }
      | { __typename: 'UserlandUserAlreadyInvited'; userlandUserId: string; organizationId: string };
  }>('addUserlandUserToOrg', options, {
    input: {
      organizationId: options.org,
      userlandUserId: options.user,
      ...(options.role ? { roleId: options.role } : {}),
    },
  });

  const result = data.addUserlandUserToOrganization;
  if (result.__typename === 'OrganizationNotFound') {
    exitWithError({
      code: 'not_found',
      message: `Organization "${options.org}" was not found in this environment.`,
    });
  }
  if (result.__typename === 'UserlandUserNotFound') {
    exitWithError({ code: 'not_found', message: `User "${options.user}" was not found in this environment.` });
  }
  if (result.__typename === 'UserlandUserAlreadyInvited') {
    exitWithError({
      code: 'already_invited',
      message: `User "${options.user}" already has a pending invitation to organization "${options.org}".`,
    });
  }
  if (result.__typename !== 'UserlandUserAddedToOrganization') {
    exitWithError({
      code: 'unexpected_result',
      message: `Could not add user "${options.user}" to organization "${options.org}".`,
    });
  }

  // The success variant carries no membership record, so the output reports the
  // pair that was linked rather than inventing one.
  if (isJsonMode()) {
    outputJson({ added: { organizationId: options.org, userId: options.user } });
    return;
  }
  outputSuccess(`Added user ${chalk.bold(options.user)} to organization ${chalk.bold(options.org)}`);
}

export interface MembershipUpdateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** Role ID (role_*) to assign. */
  role?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runMembershipUpdate(id: string, options: MembershipUpdateOptions = {}): Promise<void> {
  if (!options.role) {
    exitWithError({ code: 'missing_argument', message: 'Nothing to update. Pass --role with the new role ID.' });
  }

  // require-flag: a privilege change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `change the role on membership ${id}` });

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { data } = await runEnvScopedOperation<{
    updateRoleOnOrganizationMembership:
      | { __typename: 'RoleOnOrganizationMembershipUpdated'; organizationMembership: MembershipNode }
      | { __typename: 'RoleNotFound'; roleId: string }
      | { __typename: 'UserlandUserOrganizationMembershipNotFound'; message: string };
  }>('updateRoleOnOrganizationMembership', options, {
    input: { organizationMembershipId: id, roleId: options.role },
  });

  const result = data.updateRoleOnOrganizationMembership;
  if (result.__typename === 'RoleNotFound') {
    exitWithError({
      code: 'not_found',
      message: `Role "${result.roleId}" was not found in this environment.`,
    });
  }
  if (result.__typename === 'UserlandUserOrganizationMembershipNotFound') {
    exitWithError({ code: 'not_found', message: `Membership "${id}" was not found in this environment.` });
  }
  if (result.__typename !== 'RoleOnOrganizationMembershipUpdated' || !('organizationMembership' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not update membership "${id}".` });
  }

  const membership = shapeMembership(result.organizationMembership);
  if (isJsonMode()) {
    outputJson({ membership });
    return;
  }
  outputSuccess(`Updated membership ${chalk.bold(membership.id)}`);
}

export interface MembershipDeleteOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runMembershipDelete(id: string, options: MembershipDeleteOptions = {}): Promise<void> {
  // Destructive per the manifest: removes the user's access to the organization.
  await confirmDestructive(options, {
    action: `delete membership ${id} — this removes the user from the organization`,
  });

  const token = await requireCommandToken();
  const removeOp = getOperation('removeMemberFromOrganization');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: removeOp.kind === 'mutation',
  });

  // The remove operation is keyed by organization + user, not by membership ID,
  // so resolve the membership first to preserve the frozen `delete <id>` grammar.
  const getOp = getOperation('userlandUserOrganizationMembership');
  const lookup = await executeDashboardOperation<{ userlandUserOrganizationMembership: MembershipNode | null }>(getOp, {
    token,
    variables: { id },
    environmentId,
  });

  const membership = lookup.userlandUserOrganizationMembership;
  if (!membership || !membership.organizationId || !membership.userlandUserId) {
    exitWithError({ code: 'not_found', message: `Membership "${id}" was not found in this environment.` });
  }

  const data = await executeDashboardOperation<{
    removeUserlandUserFromOrganization:
      | { __typename: 'UserlandUserRemovedFromOrganization' }
      | { __typename: 'OrganizationNotFound'; organizationId: string }
      | { __typename: 'UserlandUserNotFound'; userlandUserId: string }
      | { __typename: 'UserlandUserOrganizationMembershipNotFound'; message: string };
  }>(removeOp, {
    token,
    variables: {
      input: { organizationId: membership.organizationId, userlandUserId: membership.userlandUserId },
    },
    environmentId,
  });

  const result = data.removeUserlandUserFromOrganization;
  if (
    result.__typename === 'OrganizationNotFound' ||
    result.__typename === 'UserlandUserNotFound' ||
    result.__typename === 'UserlandUserOrganizationMembershipNotFound'
  ) {
    exitWithError({ code: 'not_found', message: `Membership "${id}" was not found in this environment.` });
  }
  if (result.__typename !== 'UserlandUserRemovedFromOrganization') {
    exitWithError({ code: 'unexpected_result', message: `Could not delete membership "${id}".` });
  }

  if (isJsonMode()) {
    outputJson({ deleted: id });
    return;
  }
  outputSuccess(`Deleted membership ${chalk.bold(id)}`);
}

export interface MembershipDeactivateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runMembershipDeactivate(id: string, options: MembershipDeactivateOptions = {}): Promise<void> {
  // require-flag: an access removal; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `deactivate membership ${id}` });

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { data } = await runEnvScopedOperation<{
    deactivateUserlandUserOrganizationMembership:
      | { __typename: 'UserlandUserOrganizationMembershipDeactivated' }
      | { __typename: 'UserlandUserOrganizationMembershipNotFound'; message: string };
  }>('deactivateOrganizationMembership', options, { input: { userlandUserOrganizationMembershipId: id } });

  const result = data.deactivateUserlandUserOrganizationMembership;
  if (result.__typename === 'UserlandUserOrganizationMembershipNotFound') {
    exitWithError({ code: 'not_found', message: `Membership "${id}" was not found in this environment.` });
  }
  if (result.__typename !== 'UserlandUserOrganizationMembershipDeactivated') {
    exitWithError({ code: 'unexpected_result', message: `Could not deactivate membership "${id}".` });
  }

  if (isJsonMode()) {
    outputJson({ deactivated: id });
    return;
  }
  outputSuccess(`Deactivated membership ${chalk.bold(id)}`);
}

export interface MembershipReactivateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runMembershipReactivate(id: string, options: MembershipReactivateOptions = {}): Promise<void> {
  // Environment-scoped mutation: pre-validated resolved target as header.
  const { data } = await runEnvScopedOperation<{
    reactivateUserlandUserOrganizationMembership:
      | { __typename: 'UserlandUserOrganizationMembershipReactivated' }
      | { __typename: 'UserlandUserOrganizationMembershipNotFound'; message: string };
  }>('reactivateOrganizationMembership', options, { input: { userlandUserOrganizationMembershipId: id } });

  const result = data.reactivateUserlandUserOrganizationMembership;
  if (result.__typename === 'UserlandUserOrganizationMembershipNotFound') {
    exitWithError({ code: 'not_found', message: `Membership "${id}" was not found in this environment.` });
  }
  if (result.__typename !== 'UserlandUserOrganizationMembershipReactivated') {
    exitWithError({ code: 'unexpected_result', message: `Could not reactivate membership "${id}".` });
  }

  if (isJsonMode()) {
    outputJson({ reactivated: id });
    return;
  }
  outputSuccess(`Reactivated membership ${chalk.bold(id)}`);
}
