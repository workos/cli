/**
 * `workos role` — RBAC role management on the dashboard account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 5): the
 * subcommand surface (list/get/create/update/delete/set-permissions/
 * add-permission/remove-permission) is unchanged, but every operation now runs
 * catalog-backed dashboard operations with the user's OAuth bearer. Output
 * shapes are new curated shapes (approved breaking change); the authoritative
 * examples live in `role.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - The backing mutations are ID-keyed while the frozen grammar is slug-keyed,
 *   so every mutation first resolves the slug via the scope's list operation
 *   (one extra read — the membership-delete precedent).
 * - The update mutation REQUIRES a name and CLEARS the description when it is
 *   omitted, so updates read-merge-write: the current name/description ride
 *   along whenever the flags are omitted.
 * - `--org` listing includes environment roles the organization inherits.
 *   Mutating one of those through the org scope would change it
 *   environment-wide, so org-scoped mutations require the matched role to be
 *   organization-scoped and error otherwise.
 * - The permission trio (set-permissions/add-permission/remove-permission)
 *   rides the update mutation's full permission list via read-merge-write.
 *
 * Safety posture per the manifest: `delete` is destructive →
 * `confirmDestructive` (prompt, or --yes); create/update/set-permissions/
 * add-permission/remove-permission are privilege changes → `require-flag`
 * (non-interactive callers must pass --yes).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { runEnvScopedOperation, executeDashboardOperation } from '../lib/dashboard-operation.js';
import { getOperation } from '../catalog/operation.js';
import { confirmDestructive, requireConfirmationFlag } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { enumOut } from '../utils/output-conventions.js';
import { printDetailFields } from '../utils/resource-command.js';
import { formatTable } from '../utils/table.js';

interface RoleNode {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  state?: string | null;
  type?: string | null;
  permissions?: Array<{ id: string; slug: string }> | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * The curated role shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see role.spec.ts for the
 * authoritative example. `permissions` is the role's permission slugs.
 */
function shapeRole(role: RoleNode) {
  return {
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description ?? null,
    type: enumOut(role.type),
    permissions: (role.permissions ?? []).map((permission) => permission.slug),
    createdAt: role.createdAt ?? null,
    updatedAt: role.updatedAt ?? null,
  };
}

type ShapedRole = ReturnType<typeof shapeRole>;

/**
 * Fetch the roles visible in the requested scope: the environment's roles, or
 * (with `orgId`) the roles assignable within an organization. The org listing
 * includes environment roles the organization inherits — org-scoped mutations
 * must therefore check `type` before acting (see {@link requireOrgScopedRole}).
 */
async function fetchRoles(token: string, environmentId: string, orgId: string | undefined): Promise<RoleNode[]> {
  if (orgId) {
    const op = getOperation('rolesForOrganization');
    const data = await executeDashboardOperation<{ rolesForOrganization: { roles: RoleNode[] } | null }>(op, {
      token,
      variables: { organizationId: orgId, environmentId },
      environmentId,
    });
    return data.rolesForOrganization?.roles ?? [];
  }

  const op = getOperation('roles');
  const data = await executeDashboardOperation<{ rolesForEnvironment: { roles: RoleNode[] } | null }>(op, {
    token,
    variables: { id: environmentId },
    environmentId,
  });
  return data.rolesForEnvironment?.roles ?? [];
}

/** Resolve a slug within the scope's role list, or exit not_found. */
async function requireRoleBySlug(
  token: string,
  environmentId: string,
  orgId: string | undefined,
  slug: string,
): Promise<RoleNode> {
  const roles = await fetchRoles(token, environmentId, orgId);
  const role = roles.find((candidate) => candidate.slug === slug);
  if (!role) {
    exitWithError({
      code: 'not_found',
      message: orgId
        ? `Role "${slug}" was not found in organization "${orgId}".`
        : `Role "${slug}" was not found in this environment.`,
    });
  }
  return role;
}

/**
 * Guard for org-scoped mutations: the org listing dedupes by slug with the
 * organization's own role winning, so a match can still be an INHERITED
 * environment role — mutating that through the org scope would change it
 * environment-wide. Refuse loudly instead.
 */
function requireOrgScopedRole(role: RoleNode, slug: string, orgId: string): void {
  if (enumOut(role.type) !== 'organization') {
    exitWithError({
      code: 'invalid_argument',
      message:
        `Role "${slug}" in organization "${orgId}" is an environment role. ` +
        'Modifying it here would change it for every organization — rerun without --org to update the environment role.',
    });
  }
}

function renderRoleTable(roles: ShapedRole[]): void {
  const rows = roles.map((role) => [
    role.slug,
    role.name,
    role.type ?? chalk.dim('-'),
    String(role.permissions.length),
    role.createdAt ?? chalk.dim('-'),
  ]);
  console.log(
    formatTable(
      [{ header: 'Slug' }, { header: 'Name' }, { header: 'Type' }, { header: 'Permissions' }, { header: 'Created' }],
      rows,
    ),
  );
}

function renderRoleFields(role: ShapedRole): void {
  const fields: Array<[string, unknown]> = [
    ['Slug', role.slug],
    ['Name', role.name],
    ['Type', role.type],
    ['Description', role.description],
    ['Permissions', role.permissions.length > 0 ? role.permissions.join(', ') : null],
    ['Created', role.createdAt],
  ];
  printDetailFields(fields);
}

export interface RoleScopeOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** `--org`: act on the organization scope instead of the environment. */
  org?: string;
}

export async function runRoleList(options: RoleScopeOptions = {}): Promise<void> {
  const token = await requireCommandToken();

  // Environment-scoped read: both list ops take the resolved ID as a variable
  // and it rides as the environment header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: false,
  });

  const roles = (await fetchRoles(token, environmentId, options.org)).map(shapeRole);

  if (isJsonMode()) {
    outputJson({ roles });
    return;
  }
  if (roles.length === 0) {
    console.log('No roles found.');
    return;
  }
  renderRoleTable(roles);
}

export async function runRoleGet(slug: string, options: RoleScopeOptions = {}): Promise<void> {
  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: false,
  });

  const role = shapeRole(await requireRoleBySlug(token, environmentId, options.org, slug));

  if (isJsonMode()) {
    outputJson({ role });
    return;
  }
  renderRoleFields(role);
}

export interface RoleCreateOptions extends RoleScopeOptions {
  slug: string;
  name: string;
  description?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runRoleCreate(options: RoleCreateOptions): Promise<void> {
  // require-flag: expands the privilege surface; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `create role ${options.slug}` });

  // Environment-scoped mutation: pre-validated resolved target as header (the
  // create input carries no environment field — the header IS the scope).
  const { data } = await runEnvScopedOperation<{
    createRole:
      | { __typename: 'RoleCreated'; role: RoleNode }
      | { __typename: 'RoleAlreadyExists'; slug: string }
      | { __typename: 'EnvironmentNotFound'; environmentId: string };
  }>('createRole', options, {
    input: {
      slug: options.slug,
      name: options.name,
      ...(options.description !== undefined ? { description: options.description } : {}),
      ...(options.org ? { organizationId: options.org } : {}),
    },
  });

  const result = data.createRole;
  if (result.__typename === 'RoleAlreadyExists') {
    exitWithError({ code: 'already_exists', message: `A role with slug "${options.slug}" already exists.` });
  }
  if (result.__typename === 'EnvironmentNotFound') {
    exitWithError({ code: 'not_found', message: 'The target environment was not found.' });
  }
  if (result.__typename !== 'RoleCreated' || !('role' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not create role "${options.slug}".` });
  }

  const role = shapeRole(result.role);
  if (isJsonMode()) {
    outputJson({ role });
    return;
  }
  outputSuccess(`Created role ${chalk.bold(role.slug)}`);
}

/**
 * Shared updateRole call: the input REQUIRES `name` and CLEARS `description`
 * when omitted, so callers pass the full merged trio (and optionally the full
 * permission-slug list — omitting `permissions` leaves them unchanged).
 *
 * The mutation's response role carries NO permission selection, so the shaped
 * result overlays `effectivePermissions` — the slugs known to hold after this
 * mutation (the list that was sent, or the pre-mutation list when none was).
 */
async function executeRoleUpdate(
  token: string,
  environmentId: string,
  input: { roleId: string; name: string; description?: string; permissions?: string[] },
  slug: string,
  effectivePermissions: string[],
): Promise<ShapedRole> {
  const op = getOperation('updateRole');

  const data = await executeDashboardOperation<{
    updateRole: { __typename: 'RoleUpdated'; role: RoleNode } | { __typename: 'RoleNotFound'; roleId: string };
  }>(op, { token, variables: { input }, environmentId });

  const result = data.updateRole;
  if (result.__typename === 'RoleNotFound') {
    exitWithError({ code: 'not_found', message: `Role "${slug}" was not found in this environment.` });
  }
  if (result.__typename !== 'RoleUpdated' || !('role' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not update role "${slug}".` });
  }
  return { ...shapeRole(result.role), permissions: effectivePermissions };
}

/** The role's current permission slugs (from the scope's list operation). */
function permissionSlugsOf(role: RoleNode): string[] {
  return (role.permissions ?? []).map((permission) => permission.slug);
}

/** Merge current name/description into an update input (see executeRoleUpdate). */
function mergedUpdateInput(
  role: RoleNode,
  overrides: { name?: string; description?: string },
): { roleId: string; name: string; description?: string } {
  const description = overrides.description ?? role.description ?? undefined;
  return {
    roleId: role.id,
    name: overrides.name ?? role.name,
    ...(description !== undefined ? { description } : {}),
  };
}

export interface RoleUpdateOptions extends RoleScopeOptions {
  name?: string;
  description?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runRoleUpdate(slug: string, options: RoleUpdateOptions = {}): Promise<void> {
  if (options.name === undefined && options.description === undefined) {
    exitWithError({ code: 'missing_argument', message: 'Nothing to update. Pass --name and/or --description.' });
  }

  // require-flag: a privilege change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `update role ${slug}` });

  const token = await requireCommandToken();

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });

  // The mutation is ID-keyed; resolve the frozen slug grammar via the scope's
  // list first (and refuse to touch an inherited environment role via --org).
  const role = await requireRoleBySlug(token, environmentId, options.org, slug);
  if (options.org) {
    requireOrgScopedRole(role, slug, options.org);
  }

  const updated = await executeRoleUpdate(
    token,
    environmentId,
    mergedUpdateInput(role, { name: options.name, description: options.description }),
    slug,
    permissionSlugsOf(role), // permissions unchanged by this input
  );

  if (isJsonMode()) {
    outputJson({ role: updated });
    return;
  }
  outputSuccess(`Updated role ${chalk.bold(updated.slug)}`);
}

export interface RoleDeleteOptions extends RoleScopeOptions {
  /** Required by the command grammar: only organization roles can be deleted. */
  org: string;
  yes?: boolean;
  json?: boolean;
}

export async function runRoleDelete(slug: string, options: RoleDeleteOptions): Promise<void> {
  // Destructive per the manifest: permanently deletes the role; members lose it.
  await confirmDestructive(options, {
    action: `delete role ${slug} — this permanently removes the role and unassigns its members`,
  });

  const token = await requireCommandToken();
  const op = getOperation('deleteRole');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  const role = await requireRoleBySlug(token, environmentId, options.org, slug);
  requireOrgScopedRole(role, slug, options.org);

  const data = await executeDashboardOperation<{
    deleteRole:
      | { __typename: 'RoleDeleted' }
      | { __typename: 'RoleNotFound'; roleId: string }
      | { __typename: 'EnvironmentNotFound'; environmentId: string };
  }>(op, { token, variables: { input: { roleId: role.id } }, environmentId });

  const result = data.deleteRole;
  if (result.__typename === 'RoleNotFound' || result.__typename === 'EnvironmentNotFound') {
    exitWithError({ code: 'not_found', message: `Role "${slug}" was not found in organization "${options.org}".` });
  }
  if (result.__typename !== 'RoleDeleted') {
    exitWithError({ code: 'unexpected_result', message: `Could not delete role "${slug}".` });
  }

  if (isJsonMode()) {
    outputJson({ deleted: slug });
    return;
  }
  outputSuccess(`Deleted role ${chalk.bold(slug)}`);
}

export interface RolePermissionsOptions extends RoleScopeOptions {
  yes?: boolean;
  json?: boolean;
}

export async function runRoleSetPermissions(
  slug: string,
  permissions: string[],
  options: RolePermissionsOptions = {},
): Promise<void> {
  // require-flag: a privilege change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `replace the permissions on role ${slug}` });

  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });

  const role = await requireRoleBySlug(token, environmentId, options.org, slug);
  if (options.org) {
    requireOrgScopedRole(role, slug, options.org);
  }

  const updated = await executeRoleUpdate(
    token,
    environmentId,
    { ...mergedUpdateInput(role, {}), permissions },
    slug,
    permissions,
  );

  if (isJsonMode()) {
    outputJson({ role: updated });
    return;
  }
  outputSuccess(
    `Set ${permissions.length} permission${permissions.length === 1 ? '' : 's'} on role ${chalk.bold(slug)}`,
  );
}

export async function runRoleAddPermission(
  slug: string,
  permissionSlug: string,
  options: RolePermissionsOptions = {},
): Promise<void> {
  // require-flag: a privilege change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `add permission ${permissionSlug} to role ${slug}` });

  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });

  const role = await requireRoleBySlug(token, environmentId, options.org, slug);
  if (options.org) {
    requireOrgScopedRole(role, slug, options.org);
  }

  // The backing mutation carries the FULL permission list — merge (deduped)
  // rather than sending just the addition.
  const current = permissionSlugsOf(role);
  const permissions = [...new Set([...current, permissionSlug])];

  const updated = await executeRoleUpdate(
    token,
    environmentId,
    { ...mergedUpdateInput(role, {}), permissions },
    slug,
    permissions,
  );

  if (isJsonMode()) {
    outputJson({ role: updated });
    return;
  }
  outputSuccess(`Added permission ${chalk.bold(permissionSlug)} to role ${chalk.bold(slug)}`);
}

export interface RoleRemovePermissionOptions extends RolePermissionsOptions {
  /** Required by the command grammar: org-scoped removal only. */
  org: string;
}

export async function runRoleRemovePermission(
  slug: string,
  permissionSlug: string,
  options: RoleRemovePermissionOptions,
): Promise<void> {
  // require-flag: a privilege change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `remove permission ${permissionSlug} from role ${slug}` });

  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });

  const role = await requireRoleBySlug(token, environmentId, options.org, slug);
  requireOrgScopedRole(role, slug, options.org);

  const current = permissionSlugsOf(role);
  if (!current.includes(permissionSlug)) {
    exitWithError({
      code: 'not_found',
      message: `Role "${slug}" does not have permission "${permissionSlug}".`,
    });
  }
  const permissions = current.filter((candidate) => candidate !== permissionSlug);

  const updated = await executeRoleUpdate(
    token,
    environmentId,
    { ...mergedUpdateInput(role, {}), permissions },
    slug,
    permissions,
  );

  if (isJsonMode()) {
    outputJson({ role: updated });
    return;
  }
  outputSuccess(`Removed permission ${chalk.bold(permissionSlug)} from role ${chalk.bold(slug)}`);
}
