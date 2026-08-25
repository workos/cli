/**
 * `workos invitation` — AuthKit user-invitation lifecycle on the dashboard
 * account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 4): the
 * subcommand surface (list/get/send/revoke/resend) is unchanged, but every
 * operation now runs catalog-backed dashboard operations with the user's OAuth
 * bearer. Output shapes are new curated shapes (approved breaking change); the
 * authoritative examples live in `invitation.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `list` splits across two operations: env-wide vs by-org (`--org`).
 *   `--email` maps to the search variable; `--order` has no backing variable
 *   and was dropped.
 * - `get <id>` has no backing single-invitation operation: it client-side
 *   filters the most recent {@link INVITATION_GET_SCAN_LIMIT} invitations and
 *   reports a capped miss loudly.
 * - `send --expires-in-days` is required server-side; the CLI defaults to 7
 *   days (the REST default) when the flag is omitted.
 * - `--role` takes a role ID (role_*), not a role slug.
 *
 * Safety posture per the manifest: `revoke` is destructive →
 * `confirmDestructive` (prompt, or --yes).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation } from '../catalog/operation.js';
import { runEnvScopedOperation, executeDashboardOperation } from '../lib/dashboard-operation.js';
import { confirmDestructive } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { enumOut } from '../utils/output-conventions.js';
import { formatTable } from '../utils/table.js';
import { printDetailFields, printPaginationFooter } from '../utils/resource-command.js';

/** `invitation get` scans at most this many recent invitations (no fan-out). */
export const INVITATION_GET_SCAN_LIMIT = 100;

/** The server default for `--expires-in-days` (matches the REST default). */
const DEFAULT_EXPIRES_IN_DAYS = 7;

interface InvitationNode {
  id: string;
  inviteeEmail?: string | null;
  state?: string | null;
  createdAt?: string | null;
  organization?: { id: string; name: string | null } | null;
}

/**
 * The curated invitation shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see invitation.spec.ts for the
 * authoritative example.
 */
function shapeInvitation(invitation: InvitationNode) {
  return {
    id: invitation.id,
    email: invitation.inviteeEmail ?? null,
    state: enumOut(invitation.state),
    createdAt: invitation.createdAt ?? null,
    organization: invitation.organization
      ? { id: invitation.organization.id, name: invitation.organization.name ?? null }
      : null,
  };
}

type ShapedInvitation = ReturnType<typeof shapeInvitation>;

function renderInvitationTable(invitations: ShapedInvitation[]): void {
  const rows = invitations.map((inv) => [
    inv.id,
    inv.email ?? chalk.dim('-'),
    inv.organization?.id ?? chalk.dim('-'),
    inv.state ?? chalk.dim('-'),
    inv.createdAt ?? chalk.dim('-'),
  ]);
  console.log(
    formatTable(
      [{ header: 'ID' }, { header: 'Email' }, { header: 'Org ID' }, { header: 'State' }, { header: 'Created' }],
      rows,
    ),
  );
}

interface InvitationPage {
  invitations: ShapedInvitation[];
  pagination: { before: string | null; after: string | null };
}

/** Fetch one page of env-wide invitations (also backs `invitation get`). */
async function fetchEnvironmentInvitations(
  token: string,
  environmentId: string,
  variables: { search?: string; limit?: number; before?: string; after?: string },
): Promise<InvitationPage> {
  const op = getOperation('userlandUserInvites');
  const data = await executeDashboardOperation<{
    userlandUserInvites: {
      data: InvitationNode[];
      listMetadata: { before: string | null; after: string | null };
    } | null;
  }>(op, { token, variables: { environmentId, ...variables }, environmentId });
  return {
    invitations: (data.userlandUserInvites?.data ?? []).map(shapeInvitation),
    pagination: {
      before: data.userlandUserInvites?.listMetadata?.before ?? null,
      after: data.userlandUserInvites?.listMetadata?.after ?? null,
    },
  };
}

export interface InvitationListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  org?: string;
  /** `--email` filter — served by the dashboard search. */
  email?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export async function runInvitationList(options: InvitationListOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const pageVariables = {
    ...(options.email ? { search: options.email } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.before ? { before: options.before } : {}),
    ...(options.after ? { after: options.after } : {}),
  };

  let page: InvitationPage;
  if (options.org) {
    const op = getOperation('userlandUserInvitesByOrg');
    const { environmentId } = await resolveEnvironmentTarget(token, {
      flagValue: options.environmentId,
      forMutation: op.kind === 'mutation',
    });

    const data = await executeDashboardOperation<{
      organization: {
        userlandUserInvites: {
          data: InvitationNode[];
          listMetadata: { before: string | null; after: string | null };
        } | null;
      } | null;
    }>(op, { token, variables: { organizationId: options.org, ...pageVariables }, environmentId });

    if (!data.organization) {
      exitWithError({
        code: 'not_found',
        message: `Organization "${options.org}" was not found in this environment.`,
      });
    }

    // Per-invite organization is not part of the by-org payload — it is implied
    // by the filter, so the curated shape carries the requested org ID.
    page = {
      invitations: (data.organization.userlandUserInvites?.data ?? []).map((invitation) =>
        shapeInvitation({ ...invitation, organization: { id: options.org as string, name: null } }),
      ),
      pagination: {
        before: data.organization.userlandUserInvites?.listMetadata?.before ?? null,
        after: data.organization.userlandUserInvites?.listMetadata?.after ?? null,
      },
    };
  } else {
    const op = getOperation('userlandUserInvites');
    const { environmentId } = await resolveEnvironmentTarget(token, {
      flagValue: options.environmentId,
      forMutation: op.kind === 'mutation',
    });
    page = await fetchEnvironmentInvitations(token, environmentId, pageVariables);
  }

  if (isJsonMode()) {
    outputJson({ invitations: page.invitations, pagination: page.pagination });
    return;
  }

  if (page.invitations.length === 0) {
    console.log('No invitations found.');
    return;
  }
  renderInvitationTable(page.invitations);
  printPaginationFooter(page.pagination);
}

export interface InvitationGetOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runInvitationGet(id: string, options: InvitationGetOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('userlandUserInvites');

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  // There is no single-invitation operation, so filter the most recent page
  // client-side — capped, never an unbounded scan.
  const page = await fetchEnvironmentInvitations(token, environmentId, { limit: INVITATION_GET_SCAN_LIMIT });
  const invitation = page.invitations.find((candidate) => candidate.id === id);

  if (!invitation) {
    exitWithError({
      code: 'not_found',
      message: `Invitation "${id}" was not found in the ${INVITATION_GET_SCAN_LIMIT} most recent invitations in this environment. Use \`invitation list\` to page through older invitations.`,
    });
  }

  if (isJsonMode()) {
    outputJson({ invitation });
    return;
  }

  const fields: Array<[string, unknown]> = [
    ['ID', invitation.id],
    ['Email', invitation.email],
    ['Org ID', invitation.organization?.id ?? null],
    ['State', invitation.state],
    ['Created', invitation.createdAt],
  ];
  printDetailFields(fields);
}

export interface InvitationSendOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  email: string;
  org?: string;
  /** Role ID (role_*) to assign when the invite is accepted. */
  role?: string;
  expiresInDays?: number;
}

export async function runInvitationSend(options: InvitationSendOptions): Promise<void> {
  // Environment-scoped mutation: pre-validated resolved target, sent as both
  // input field and environment header. The catch-all stays: the business-error
  // variants are dispatched by typename through `sendErrors` below, not by
  // per-variant narrowing.
  const { data } = await runEnvScopedOperation<{
    createUserlandUserInvite:
      | { __typename: 'UserlandUserInviteCreated'; userlandUserInvite: { id: string } }
      | { __typename: string };
  }>('createUserlandUserInvite', options, (environmentId) => ({
    input: {
      environmentId,
      inviteeEmail: options.email,
      // Required server-side; default matches the REST plane's behavior.
      expiresInDays: options.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS,
      ...(options.org ? { organizationId: options.org } : {}),
      ...(options.role ? { roleId: options.role } : {}),
    },
  }));

  const result = data.createUserlandUserInvite;
  // Business-error variants carry only their typename; map each to clean copy.
  const sendErrors: Record<string, { code: string; message: string }> = {
    EnvironmentNotFound: {
      code: 'environment_not_found',
      message: 'The target environment was not found.',
    },
    OrganizationNotFound: {
      code: 'not_found',
      message: `Organization "${options.org ?? ''}" was not found in this environment.`,
    },
    UserlandUserNotFound: {
      code: 'not_found',
      message: 'The user for this invitation was not found in this environment.',
    },
    CreateUserlandUserInviteExpiresInDaysTooLong: {
      code: 'invalid_argument',
      message: `--expires-in-days ${options.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS} is too long.`,
    },
    CreateUserlandUserInviteExpiresInDaysTooShort: {
      code: 'invalid_argument',
      message: `--expires-in-days ${options.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS} is too short.`,
    },
    CreateUserlandUserInviteUserAlreadyExists: {
      code: 'already_exists',
      message: `A user with the email ${options.email} already exists in this environment.`,
    },
    CreateUserlandUserInviteUserAlreadyOrganizationMember: {
      code: 'already_member',
      message: `${options.email} is already a member of organization "${options.org ?? ''}".`,
    },
    CreateUserlandUserInviteInvalidInviteeEmail: {
      code: 'invalid_argument',
      message: `"${options.email}" is not a valid email address.`,
    },
    CreateUserlandUserInviteEmailAlreadyInvitedToEnvironment: {
      code: 'already_invited',
      message: `${options.email} already has a pending invitation in this environment.`,
    },
    CreateUserlandUserInviteEmailAlreadyInvitedToOrganization: {
      code: 'already_invited',
      message: `${options.email} already has a pending invitation to organization "${options.org ?? ''}".`,
    },
    CreateUserlandUserInviteInvalidRole: {
      code: 'invalid_argument',
      message: `Role "${options.role ?? ''}" is not valid for this invitation.`,
    },
  };
  const sendError = sendErrors[result.__typename];
  if (sendError) {
    exitWithError(sendError);
  }
  if (result.__typename !== 'UserlandUserInviteCreated' || !('userlandUserInvite' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not send an invitation to ${options.email}.` });
  }

  const invitation = { id: (result as { userlandUserInvite: { id: string } }).userlandUserInvite.id };
  if (isJsonMode()) {
    outputJson({ invitation });
    return;
  }
  outputSuccess(`Sent invitation to ${chalk.bold(options.email)}`);
  console.log(chalk.dim(`  id: ${invitation.id}`));
}

export interface InvitationRevokeOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runInvitationRevoke(id: string, options: InvitationRevokeOptions = {}): Promise<void> {
  // Destructive per the manifest: invalidates the pending invite link.
  await confirmDestructive(options, {
    action: `revoke invitation ${id} — the invite link can no longer be accepted`,
  });

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { data } = await runEnvScopedOperation<{
    revokeUserlandUserInvite:
      | { __typename: 'UserlandUserInviteRevoked'; userlandUserInvite: { id: string } }
      | { __typename: 'UserlandUserInviteNotFound' }
      | { __typename: 'UserlandUserInviteNotPending' };
  }>('revokeUserlandUserInvite', options, { input: { userlandUserInviteId: id } });

  const result = data.revokeUserlandUserInvite;
  if (result.__typename === 'UserlandUserInviteNotFound') {
    exitWithError({ code: 'not_found', message: `Invitation "${id}" was not found in this environment.` });
  }
  if (result.__typename === 'UserlandUserInviteNotPending') {
    exitWithError({
      code: 'invite_not_pending',
      message: `Invitation "${id}" is not pending; only pending invitations can be revoked.`,
    });
  }
  if (result.__typename !== 'UserlandUserInviteRevoked') {
    exitWithError({ code: 'unexpected_result', message: `Could not revoke invitation "${id}".` });
  }

  if (isJsonMode()) {
    outputJson({ revoked: id });
    return;
  }
  outputSuccess(`Revoked invitation ${chalk.bold(id)}`);
}

export interface InvitationResendOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runInvitationResend(id: string, options: InvitationResendOptions = {}): Promise<void> {
  // Environment-scoped mutation: pre-validated resolved target as header.
  const { data } = await runEnvScopedOperation<{
    resendUserlandUserInvite:
      | { __typename: 'UserlandUserInviteResent'; userlandUserInvite: { id: string } }
      | { __typename: 'UserlandUserInviteNotFound' }
      | { __typename: 'UserlandUserInviteNotPending' };
  }>('resendUserlandUserInvite', options, { input: { userlandUserInviteId: id } });

  const result = data.resendUserlandUserInvite;
  if (result.__typename === 'UserlandUserInviteNotFound') {
    exitWithError({ code: 'not_found', message: `Invitation "${id}" was not found in this environment.` });
  }
  if (result.__typename === 'UserlandUserInviteNotPending') {
    exitWithError({
      code: 'invite_not_pending',
      message: `Invitation "${id}" is not pending; only pending invitations can be resent.`,
    });
  }
  if (result.__typename !== 'UserlandUserInviteResent') {
    exitWithError({ code: 'unexpected_result', message: `Could not resend invitation "${id}".` });
  }

  if (isJsonMode()) {
    outputJson({ resent: id });
    return;
  }
  outputSuccess(`Resent invitation ${chalk.bold(id)}`);
}
