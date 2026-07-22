/**
 * `workos user` — AuthKit user lifecycle on the dashboard account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 3): the
 * subcommand surface (get/list/update/delete — there is deliberately no
 * `create`) is unchanged, but every operation now runs catalog-backed dashboard
 * operations with the user's OAuth bearer. Output shapes are new curated shapes
 * (approved breaking change); the authoritative examples live in
 * `user.spec.ts`.
 *
 * Every operation here is environment-scoped: the target rides as the
 * `x-url-environment-id` header (and, where the operation declares it, as a
 * variable), resolved through `resolveEnvironmentTarget()`. Mutations
 * pre-validate the resolved target; reads trust stored state.
 *
 * Safety posture per the manifest: `user delete` is destructive (permanently
 * deletes the end user) → `confirmDestructive` (prompt, or --yes).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { confirmDestructive } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

/** Map the CLI `--order asc|desc` flag onto the catalog's pagination enum. */
function normalizeOrder(order: string | undefined): 'Asc' | 'Desc' | undefined {
  if (order === undefined) return undefined;
  const lower = order.toLowerCase();
  if (lower === 'asc') return 'Asc';
  if (lower === 'desc') return 'Desc';
  exitWithError({ code: 'invalid_argument', message: `Invalid --order "${order}". Allowed values: asc, desc.` });
}

interface IdentityNode {
  id: string;
  status?: string | null;
  organization?: { id: string; name: string | null } | null;
  roles?: Array<{ id: string; name: string | null }> | null;
}

interface UserNode {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  createdAt?: string | null;
  emailVerifiedAt?: string | null;
  lastSignedInAt?: string | null;
  sessionCount?: number | null;
  hasPassword?: boolean | null;
  locale?: string | null;
  externalId?: string | null;
  profilePictureUrl?: string | null;
  metadata?: Array<{ key: string; value: string }> | null;
  identities?: { data: IdentityNode[] } | null;
  authenticationFactors?: Array<{ id: string; lastVerifiedAt?: string | null }> | null;
}

/**
 * The curated user shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see user.spec.ts for the
 * authoritative example.
 */
function shapeUser(user: UserNode) {
  return {
    id: user.id,
    email: user.email ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    createdAt: user.createdAt ?? null,
    emailVerifiedAt: user.emailVerifiedAt ?? null,
    lastSignedInAt: user.lastSignedInAt ?? null,
    sessionCount: user.sessionCount ?? null,
    hasPassword: user.hasPassword ?? null,
    locale: user.locale ?? null,
    externalId: user.externalId ?? null,
    profilePictureUrl: user.profilePictureUrl ?? null,
    metadata: user.metadata ?? [],
    identities: (user.identities?.data ?? []).map((identity) => ({
      id: identity.id,
      status: identity.status ?? null,
      organization: identity.organization
        ? { id: identity.organization.id, name: identity.organization.name ?? null }
        : null,
      roles: (identity.roles ?? []).map((role) => ({ id: role.id, name: role.name ?? null })),
    })),
  };
}

export interface UserGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runUserGet(userId: string, options: UserGetOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('userlandUser');

  // Environment-scoped read: the op takes only `id`, but the target still
  // rides as the environment header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: { userlandUser: UserNode | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { id: userId },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (!data.userlandUser) {
    exitWithError({ code: 'not_found', message: `User "${userId}" was not found in this environment.` });
  }

  const user = {
    ...shapeUser(data.userlandUser),
    authenticationFactors: (data.userlandUser.authenticationFactors ?? []).map((factor) => ({
      id: factor.id,
      lastVerifiedAt: factor.lastVerifiedAt ?? null,
    })),
  };
  if (isJsonMode()) {
    outputJson({ user });
    return;
  }

  const fields: Array<[string, unknown]> = [
    ['ID', user.id],
    ['Email', user.email],
    ['Name', [user.firstName, user.lastName].filter(Boolean).join(' ') || null],
    ['Verified', user.emailVerifiedAt ? 'Yes' : 'No'],
    ['Created', user.createdAt],
    ['Last sign-in', user.lastSignedInAt],
    ['External ID', user.externalId],
  ];
  for (const [label, value] of fields) {
    if (value === null || value === undefined || value === '') continue;
    console.log(`${chalk.bold(label)}: ${String(value)}`);
  }
  console.log(chalk.dim('Run with --json for the full record.'));
}

export interface UserListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** `--email` filter — served by the dashboard search. */
  email?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runUserList(options: UserListOptions = {}): Promise<void> {
  const order = normalizeOrder(options.order);
  const token = await requireCommandToken();
  const op = getOperation('userlandUsers');

  // Environment-scoped read: resolved target as variable + header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    userlandUsers: {
      data: UserNode[];
      listMetadata: { before: string | null; after: string | null };
    } | null;
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: {
        environmentId,
        ...(options.email ? { search: options.email } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.before ? { before: options.before } : {}),
        ...(options.after ? { after: options.after } : {}),
        ...(order ? { order } : {}),
      },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const users = data.userlandUsers?.data ?? [];
  const pagination = {
    before: data.userlandUsers?.listMetadata?.before ?? null,
    after: data.userlandUsers?.listMetadata?.after ?? null,
  };

  if (isJsonMode()) {
    outputJson({ users: users.map(shapeUser), pagination });
    return;
  }

  if (users.length === 0) {
    console.log('No users found.');
    return;
  }

  const rows = users.map((user) => [
    user.id,
    user.email ?? chalk.dim('—'),
    user.firstName || chalk.dim('-'),
    user.lastName || chalk.dim('-'),
    user.emailVerifiedAt ? 'Yes' : 'No',
  ]);
  console.log(
    formatTable(
      [{ header: 'ID' }, { header: 'Email' }, { header: 'First Name' }, { header: 'Last Name' }, { header: 'Verified' }],
      rows,
    ),
  );

  const { before, after } = pagination;
  if (before && after) {
    console.log(chalk.dim(`Before: ${before}  After: ${after}`));
  } else if (before) {
    console.log(chalk.dim(`Before: ${before}`));
  } else if (after) {
    console.log(chalk.dim(`After: ${after}`));
  }
}

export interface UserUpdateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  locale?: string;
  externalId?: string;
}

export async function runUserUpdate(userId: string, options: UserUpdateOptions = {}): Promise<void> {
  const updates = {
    ...(options.firstName !== undefined ? { firstName: options.firstName } : {}),
    ...(options.lastName !== undefined ? { lastName: options.lastName } : {}),
    ...(options.email !== undefined ? { email: options.email } : {}),
    ...(options.locale !== undefined ? { locale: options.locale } : {}),
    ...(options.externalId !== undefined ? { externalId: options.externalId } : {}),
  };
  if (Object.keys(updates).length === 0) {
    exitWithError({
      code: 'missing_argument',
      message: 'Nothing to update. Pass at least one of --first-name, --last-name, --email, --locale, --external-id.',
    });
  }

  const token = await requireCommandToken();
  const op = getOperation('updateUserlandUser');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    updateUserlandUser:
      | {
          __typename: 'UserlandUserUpdated';
          userlandUser: { id: string; email: string | null; firstName: string | null; lastName: string | null };
        }
      | { __typename: 'UserlandUserNotFound' }
      | { __typename: 'UserlandUserChangeEmailError'; reason: string }
      | { __typename: 'ExternalIDAlreadyUsed'; externalId: string }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { userlandUserId: userId, ...updates } },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.updateUserlandUser;
  if (result.__typename === 'UserlandUserNotFound') {
    exitWithError({ code: 'not_found', message: `User "${userId}" was not found in this environment.` });
  }
  if (result.__typename === 'UserlandUserChangeEmailError') {
    // The server's reason is an internal enum; keep the copy clean rather than
    // echoing internal naming.
    exitWithError({
      code: 'email_change_failed',
      message: `Could not change the email address for "${userId}". The new email may be invalid or already in use.`,
    });
  }
  if (result.__typename === 'ExternalIDAlreadyUsed') {
    exitWithError({
      code: 'external_id_in_use',
      message: `External ID "${(result as { externalId: string }).externalId}" is already in use.`,
    });
  }
  if (result.__typename !== 'UserlandUserUpdated' || !('userlandUser' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not update user "${userId}".` });
  }

  const updated = (
    result as {
      userlandUser: { id: string; email: string | null; firstName: string | null; lastName: string | null };
    }
  ).userlandUser;
  const user = {
    id: updated.id,
    email: updated.email ?? null,
    firstName: updated.firstName ?? null,
    lastName: updated.lastName ?? null,
  };
  if (isJsonMode()) {
    outputJson({ user });
    return;
  }
  outputSuccess(`Updated user ${chalk.bold(user.email ?? user.id)}`);
}

export interface UserDeleteOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runUserDelete(userId: string, options: UserDeleteOptions = {}): Promise<void> {
  const op = getOperation('deleteUserlandUser');
  // Destructive per the manifest; the consequence copy comes from the catalog's
  // confirmation phrase ("permanently deletes the end user").
  const consequence = op.confirmation ? ` — this ${op.confirmation}` : '';
  await confirmDestructive(options, { action: `delete user ${userId}${consequence}` });

  const token = await requireCommandToken();

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    deleteUserlandUser: { __typename: 'UserlandUserDeleted' } | { __typename: 'UserlandUserNotFound' } | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { userlandUserId: userId } },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (data.deleteUserlandUser.__typename === 'UserlandUserNotFound') {
    exitWithError({ code: 'not_found', message: `User "${userId}" was not found in this environment.` });
  }

  if (isJsonMode()) {
    outputJson({ deleted: userId });
    return;
  }
  outputSuccess(`Deleted user ${chalk.bold(userId)}`);
}
