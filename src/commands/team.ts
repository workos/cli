/**
 * `workos team` — account-plane dashboard-team lifecycle.
 *
 * These manage the WorkOS *dashboard team* (the account's members, invites, and
 * team-wide settings), via the dashboard account plane with the user's OAuth
 * bearer — the same gated capability `whoami` uses. Safety posture per the
 * manifest:
 * - `team remove` is destructive → `confirmDestructive` (prompt, or --yes).
 * - `team change-role` / `team set-mfa` are `require-flag` → non-interactive
 *   callers must pass --yes (privilege / security-posture changes).
 */

import chalk from 'chalk';
import { getAccessToken } from '../lib/credentials.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { confirmDestructive, requireConfirmationFlag } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { exitWithAuthRequired } from '../utils/exit-codes.js';
import { formatTable } from '../utils/table.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

/** Dashboard team roles, mirroring the catalog `UsersOrganizationsRole` enum. */
export const TEAM_ROLES = ['ADMIN', 'MEMBER', 'MEMBER_SANDBOX', 'SUPPORT', 'SUPPORT_VIEWER'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

function requireToken(): string {
  const token = getAccessToken();
  if (!token) {
    exitWithAuthRequired(`Not logged in. Run \`${formatWorkOSCommand('auth login')}\` to authenticate.`);
  }
  return token;
}

function normalizeRole(role: string): TeamRole {
  const upper = role.toUpperCase();
  if (!(TEAM_ROLES as readonly string[]).includes(upper)) {
    exitWithError({
      code: 'invalid_role',
      message: `Invalid role "${role}". Allowed roles: ${TEAM_ROLES.join(', ')}.`,
    });
  }
  return upper as TeamRole;
}

interface MembershipNode {
  id: string;
  role: string | null;
  state: string | null;
  isInvitationExpired?: boolean | null;
  user: { id: string; name: string | null; email: string | null } | null;
}

export async function runTeamMembers(): Promise<void> {
  const token = requireToken();
  const op = getOperation('teamMemberships');

  let data: { currentTeam: { memberships: MembershipNode[] } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), { token });
  } catch (error) {
    reportDashboardError(error);
  }

  const memberships = data.currentTeam?.memberships ?? [];
  if (isJsonMode()) {
    outputJson({ members: memberships });
    return;
  }

  if (memberships.length === 0) {
    console.log('No team members found.');
    return;
  }

  const rows = memberships.map((m) => [
    m.id,
    m.user?.email ?? chalk.dim('(no email)'),
    m.user?.name ?? chalk.dim('—'),
    m.role ?? chalk.dim('—'),
    m.state ?? chalk.dim('—'),
  ]);
  console.log(
    formatTable(
      [{ header: 'Membership ID' }, { header: 'Email' }, { header: 'Name' }, { header: 'Role' }, { header: 'State' }],
      rows,
    ),
  );
}

export interface TeamInviteOptions {
  email: string;
  role: string;
  firstName?: string;
  lastName?: string;
}

export async function runTeamInvite(options: TeamInviteOptions): Promise<void> {
  const role = normalizeRole(options.role);
  const token = requireToken();
  const op = getOperation('inviteUserToTeam');

  let data: {
    inviteUserToTeam:
      | { __typename: 'UserInvitedToTeam'; invitedMember: MembershipNode }
      | { __typename: 'UserAlreadyBelongsToCurrentTeam'; email: string }
      | { __typename: 'UserAlreadyBelongsToAnotherTeam'; email: string }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: {
        input: {
          user: {
            email: options.email,
            role,
            ...(options.firstName ? { firstName: options.firstName } : {}),
            ...(options.lastName ? { lastName: options.lastName } : {}),
          },
        },
      },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.inviteUserToTeam;
  if (result.__typename === 'UserAlreadyBelongsToCurrentTeam') {
    exitWithError({ code: 'already_member', message: `${options.email} already belongs to this team.` });
  }
  if (result.__typename === 'UserAlreadyBelongsToAnotherTeam') {
    exitWithError({ code: 'belongs_to_another_team', message: `${options.email} already belongs to another team.` });
  }
  if (result.__typename !== 'UserInvitedToTeam' || !('invitedMember' in result)) {
    exitWithError({ code: 'unexpected_result', message: `Could not invite ${options.email}.` });
  }

  const member = (result as { invitedMember: MembershipNode }).invitedMember;
  if (isJsonMode()) {
    outputJson({ member });
    return;
  }
  outputSuccess(`Invited ${chalk.bold(options.email)} as ${member.role ?? role}`);
  console.log(chalk.dim(`  membership id: ${member.id}`));
}

export interface TeamChangeRoleOptions {
  membershipId: string;
  role: string;
  yes?: boolean;
  json?: boolean;
}

export async function runTeamChangeRole(options: TeamChangeRoleOptions): Promise<void> {
  const role = normalizeRole(options.role);
  // require-flag: a privilege change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, { action: `change the role of ${options.membershipId} to ${role}` });

  const token = requireToken();
  const op = getOperation('changeRole');

  let data: { changeRole: { id: string; role: string | null } };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { usersOrganizationsId: options.membershipId, role },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (isJsonMode()) {
    outputJson({ member: data.changeRole });
    return;
  }
  outputSuccess(`Changed role of ${chalk.bold(options.membershipId)} to ${data.changeRole.role ?? role}`);
}

export interface TeamRemoveOptions {
  membershipId: string;
  yes?: boolean;
  json?: boolean;
}

export async function runTeamRemove(options: TeamRemoveOptions): Promise<void> {
  // Destructive: revokes the member's access. Prompt (or require --yes).
  await confirmDestructive(options, { action: `remove member ${options.membershipId} from the team` });

  const token = requireToken();
  const op = getOperation('removeUserFromTeam');

  try {
    await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { usersOrganizationsId: options.membershipId },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (isJsonMode()) {
    outputJson({ removed: options.membershipId });
    return;
  }
  outputSuccess(`Removed member ${chalk.bold(options.membershipId)} from the team`);
}

export interface TeamResendInviteOptions {
  membershipId: string;
}

export async function runTeamResendInvite(options: TeamResendInviteOptions): Promise<void> {
  const token = requireToken();
  const op = getOperation('resendDashboardInvite');

  let data: { resendDashboardInvite: { __typename: string } };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { teamMembershipId: options.membershipId } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.resendDashboardInvite;
  if (result.__typename === 'DashboardInviteNotFound') {
    exitWithError({ code: 'not_found', message: `No dashboard invite found for ${options.membershipId}.` });
  }
  if (result.__typename === 'DashboardInviteNotExpired') {
    exitWithError({
      code: 'invite_not_expired',
      message: `The invite for ${options.membershipId} has not expired; nothing to resend.`,
    });
  }

  if (isJsonMode()) {
    outputJson({ resent: options.membershipId });
    return;
  }
  outputSuccess(`Resent invite for ${chalk.bold(options.membershipId)}`);
}

export interface TeamUpdateOptions {
  name: string;
}

export async function runTeamUpdate(options: TeamUpdateOptions): Promise<void> {
  const token = requireToken();
  const op = getOperation('updateTeamDetails');

  let data: {
    updateTeamDetails:
      | { __typename: 'TeamDetailsUpdated'; team: { id: string; name: string | null } }
      | { __typename: 'InvalidTeamName'; team: { id: string } }
      | { __typename: string };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { name: options.name } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const result = data.updateTeamDetails;
  if (result.__typename === 'InvalidTeamName') {
    exitWithError({ code: 'invalid_team_name', message: `"${options.name}" is not a valid team name.` });
  }
  if (result.__typename !== 'TeamDetailsUpdated' || !('team' in result)) {
    exitWithError({ code: 'unexpected_result', message: 'Could not update the team.' });
  }

  const team = (result as { team: { id: string; name: string | null } }).team;
  if (isJsonMode()) {
    outputJson({ team });
    return;
  }
  outputSuccess(`Renamed team to ${chalk.bold(team.name ?? team.id)}`);
}

export interface TeamSetMfaOptions {
  required: boolean;
  yes?: boolean;
  json?: boolean;
}

export async function runTeamSetMfa(options: TeamSetMfaOptions): Promise<void> {
  // require-flag: a security-posture change; non-interactive callers must pass --yes.
  await requireConfirmationFlag(options, {
    action: `set MFA requirement to ${options.required ? 'required' : 'not required'}`,
  });

  const token = requireToken();
  const op = getOperation('updateTeamMfaRequirement');

  let data: {
    updateTeamMfaRequirement: { __typename: string; team?: { id: string; isMfaRequired?: boolean | null } };
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { requireMfa: options.required } },
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (isJsonMode()) {
    outputJson({ team: data.updateTeamMfaRequirement.team ?? null, requireMfa: options.required });
    return;
  }
  outputSuccess(`MFA is now ${chalk.bold(options.required ? 'required' : 'not required')} for the team`);
}
