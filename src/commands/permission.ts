/**
 * `workos permission` — RBAC permission management on the dashboard account
 * plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 5): the
 * subcommand surface (list/get/create/update/delete) is unchanged, but every
 * operation now runs catalog-backed dashboard operations with the user's OAuth
 * bearer. Output shapes are new curated shapes (approved breaking change); the
 * authoritative examples live in `permission.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - The list operation has NO pagination or ordering variables, so the
 *   `--limit/--before/--after/--order` flags are removed (it returns the
 *   environment's full permission set).
 * - The mutations are ID-keyed while the frozen grammar is slug-keyed, so
 *   update/delete first resolve the slug via the list operation.
 * - The update mutation REQUIRES a name and CLEARS the description when it is
 *   omitted, so updates read-merge-write the current name/description.
 * - System permissions are immutable server-side; update/delete refuse them
 *   loudly before issuing the mutation.
 *
 * Safety posture per the manifest: `delete` is destructive →
 * `confirmDestructive` (prompt, or --yes); create/update are privilege-surface
 * changes → `require-flag` (non-interactive callers must pass --yes).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { confirmDestructive, requireConfirmationFlag } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

interface PermissionNode {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  system?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * The curated permission shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see permission.spec.ts for the
 * authoritative example.
 */
function shapePermission(permission: PermissionNode) {
  return {
    id: permission.id,
    slug: permission.slug,
    name: permission.name,
    description: permission.description ?? null,
    system: permission.system ?? false,
    createdAt: permission.createdAt ?? null,
    updatedAt: permission.updatedAt ?? null,
  };
}

/** Fetch the environment's full permission set (the op is unpaginated). */
async function fetchPermissions(token: string, environmentId: string): Promise<PermissionNode[]> {
  const op = getOperation('permissions');
  let data: { permissionsForEnvironment: { permissions: PermissionNode[] } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { id: environmentId },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }
  return data.permissionsForEnvironment?.permissions ?? [];
}

/** Resolve a slug within the environment's permission list, or exit not_found. */
async function requirePermissionBySlug(token: string, environmentId: string, slug: string): Promise<PermissionNode> {
  const permissions = await fetchPermissions(token, environmentId);
  const permission = permissions.find((candidate) => candidate.slug === slug);
  if (!permission) {
    exitWithError({ code: 'not_found', message: `Permission "${slug}" was not found in this environment.` });
  }
  return permission;
}

/** System permissions are immutable server-side — refuse before the mutation. */
function refuseSystemPermission(permission: PermissionNode, slug: string, action: string): void {
  if (permission.system) {
    exitWithError({
      code: 'invalid_argument',
      message: `Permission "${slug}" is a system permission and cannot be ${action}.`,
    });
  }
}

export interface PermissionEnvironmentOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runPermissionList(options: PermissionEnvironmentOptions = {}): Promise<void> {
  const token = await requireCommandToken();

  // Environment-scoped read: the op takes the resolved ID as a variable and it
  // rides as the environment header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: false,
  });

  const permissions = (await fetchPermissions(token, environmentId)).map(shapePermission);

  if (isJsonMode()) {
    outputJson({ permissions });
    return;
  }
  if (permissions.length === 0) {
    console.log('No permissions found.');
    return;
  }

  const rows = permissions.map((permission) => [
    permission.slug,
    permission.name,
    permission.description ?? chalk.dim('-'),
    permission.createdAt ?? chalk.dim('-'),
  ]);
  console.log(
    formatTable([{ header: 'Slug' }, { header: 'Name' }, { header: 'Description' }, { header: 'Created' }], rows),
  );
}

export async function runPermissionGet(slug: string, options: PermissionEnvironmentOptions = {}): Promise<void> {
  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: false,
  });

  const permission = shapePermission(await requirePermissionBySlug(token, environmentId, slug));

  if (isJsonMode()) {
    outputJson({ permission });
    return;
  }

  const fields: Array<[string, unknown]> = [
    ['Slug', permission.slug],
    ['Name', permission.name],
    ['Description', permission.description],
    ['System', permission.system ? 'yes' : null],
    ['Created', permission.createdAt],
  ];
  for (const [label, value] of fields) {
    if (value === null || value === undefined || value === '') continue;
    console.log(`${chalk.bold(label)}: ${String(value)}`);
  }
  console.log(chalk.dim('Run with --json for the full record.'));
}

export interface PermissionCreateOptions extends PermissionEnvironmentOptions {
  slug: string;
  name: string;
  description?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runPermissionCreate(options: PermissionCreateOptions): Promise<void> {
  // require-flag: expands the privilege surface; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `create permission ${options.slug}` });

  const token = await requireCommandToken();
  const op = getOperation('createPermission');

  // Environment-scoped mutation: pre-validated resolved target as header (the
  // create input carries no environment field — the header IS the scope).
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    createPermission:
      | { __typename: 'PermissionCreated'; permission: PermissionNode }
      | { __typename: 'PermissionAlreadyExists'; slug: string }
      | { __typename: 'PermissionSlugInvalid'; slug: string }
      | { __typename: 'EnvironmentNotFound'; environmentId: string }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: {
        input: {
          slug: options.slug,
          name: options.name,
          ...(options.description !== undefined ? { description: options.description } : {}),
        },
      },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.createPermission;
  if (result.__typename === 'PermissionAlreadyExists') {
    exitWithError({ code: 'already_exists', message: `A permission with slug "${options.slug}" already exists.` });
  }
  if (result.__typename === 'PermissionSlugInvalid') {
    exitWithError({ code: 'invalid_argument', message: `"${options.slug}" is not a valid permission slug.` });
  }
  if (result.__typename === 'EnvironmentNotFound') {
    exitWithError({ code: 'not_found', message: 'The target environment was not found.' });
  }
  if (result.__typename !== 'PermissionCreated' || !('permission' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not create permission "${options.slug}".` });
  }

  const permission = shapePermission((result as { permission: PermissionNode }).permission);
  if (isJsonMode()) {
    outputJson({ permission });
    return;
  }
  outputSuccess(`Created permission ${chalk.bold(permission.slug)}`);
}

export interface PermissionUpdateOptions extends PermissionEnvironmentOptions {
  name?: string;
  description?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runPermissionUpdate(slug: string, options: PermissionUpdateOptions = {}): Promise<void> {
  if (options.name === undefined && options.description === undefined) {
    exitWithError({ code: 'missing_argument', message: 'Nothing to update. Pass --name and/or --description.' });
  }

  // require-flag: a privilege-surface change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `update permission ${slug}` });

  const token = await requireCommandToken();
  const op = getOperation('updatePermission');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  // The mutation is ID-keyed AND requires the full name/description (an
  // omitted description would be cleared) — resolve and merge first.
  const existing = await requirePermissionBySlug(token, environmentId, slug);
  refuseSystemPermission(existing, slug, 'modified');
  const description = options.description ?? existing.description ?? undefined;

  let data: {
    updatePermission:
      | { __typename: 'PermissionUpdated'; permission: PermissionNode }
      | { __typename: 'PermissionNotFound'; permissionId: string }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: {
        input: {
          permissionId: existing.id,
          name: options.name ?? existing.name,
          ...(description !== undefined ? { description } : {}),
        },
      },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.updatePermission;
  if (result.__typename === 'PermissionNotFound') {
    exitWithError({ code: 'not_found', message: `Permission "${slug}" was not found in this environment.` });
  }
  if (result.__typename !== 'PermissionUpdated' || !('permission' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not update permission "${slug}".` });
  }

  const permission = shapePermission((result as { permission: PermissionNode }).permission);
  if (isJsonMode()) {
    outputJson({ permission });
    return;
  }
  outputSuccess(`Updated permission ${chalk.bold(permission.slug)}`);
}

export interface PermissionDeleteOptions extends PermissionEnvironmentOptions {
  yes?: boolean;
  json?: boolean;
}

export async function runPermissionDelete(slug: string, options: PermissionDeleteOptions = {}): Promise<void> {
  // Destructive per the manifest: removes the permission from every role using it.
  await confirmDestructive(options, {
    action: `delete permission ${slug} — this permanently removes it from every role that uses it`,
  });

  const token = await requireCommandToken();
  const op = getOperation('deletePermission');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  const existing = await requirePermissionBySlug(token, environmentId, slug);
  refuseSystemPermission(existing, slug, 'deleted');

  let data: {
    deletePermission:
      | { __typename: 'PermissionDeleted'; permissionId: string }
      | { __typename: 'PermissionNotFound'; permissionId: string }
      | { __typename: 'EnvironmentNotFound'; environmentId: string }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { permissionId: existing.id } },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.deletePermission;
  if (result.__typename === 'PermissionNotFound' || result.__typename === 'EnvironmentNotFound') {
    exitWithError({ code: 'not_found', message: `Permission "${slug}" was not found in this environment.` });
  }
  if (result.__typename !== 'PermissionDeleted') {
    exitWithError({ code: 'unexpected_result', message: `Could not delete permission "${slug}".` });
  }

  if (isJsonMode()) {
    outputJson({ deleted: slug });
    return;
  }
  outputSuccess(`Deleted permission ${chalk.bold(slug)}`);
}
