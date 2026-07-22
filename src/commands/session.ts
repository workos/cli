/**
 * `workos session` — AuthKit user-session inspection and revocation on the
 * dashboard account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 4): the
 * subcommand surface (list/revoke) is unchanged, but both operations now run
 * catalog-backed dashboard operations with the user's OAuth bearer. Output
 * shapes are new curated shapes (approved breaking change); the authoritative
 * examples live in `session.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `list --order` has no backing variable and was dropped.
 * - The catalog also exposes a revoke-ALL-sessions operation; it is
 *   deliberately NOT surfaced (the subcommand grammar is frozen).
 *
 * Safety posture per the manifest: `revoke` is destructive →
 * `confirmDestructive` (prompt, or --yes).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { confirmDestructive } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

interface SessionStateNode {
  __typename?: string;
  expiresAt?: string | null;
  endedAt?: string | null;
}

interface SessionNode {
  id: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  provider?: string | null;
  impersonator?: { id: string; email: string | null; firstName: string | null; lastName: string | null } | null;
  impersonationReason?: string | null;
  organization?: { id: string; name: string | null } | null;
  application?: { id: string; name: string | null } | null;
  state?: SessionStateNode | null;
}

/**
 * Map the state variant to a clean status word. Never echo the raw typename —
 * it carries internal naming.
 */
const SESSION_STATUS: Record<string, string> = {
  UserlandSessionIssued: 'active',
  UserlandSessionExpired: 'expired',
  UserlandSessionRevoked: 'revoked',
};

/**
 * The curated session shape — the `--json` contract for every subcommand.
 * camelCase, stable keys, no internal fields; see session.spec.ts for the
 * authoritative example.
 */
function shapeSession(session: SessionNode) {
  const state = session.state ?? null;
  return {
    id: session.id,
    status: state?.__typename ? (SESSION_STATUS[state.__typename] ?? null) : null,
    createdAt: session.createdAt ?? null,
    updatedAt: session.updatedAt ?? null,
    expiresAt: state?.expiresAt ?? null,
    endedAt: state?.endedAt ?? null,
    ipAddress: session.ipAddress ?? null,
    userAgent: session.userAgent ?? null,
    provider: session.provider ?? null,
    organization: session.organization
      ? { id: session.organization.id, name: session.organization.name ?? null }
      : null,
    impersonator: session.impersonator
      ? {
          id: session.impersonator.id,
          email: session.impersonator.email ?? null,
          firstName: session.impersonator.firstName ?? null,
          lastName: session.impersonator.lastName ?? null,
        }
      : null,
  };
}

export interface SessionListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export async function runSessionList(userId: string, options: SessionListOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('userlandSessions');

  // Environment-scoped read: the op takes the user ID, and the target rides as
  // the environment header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    userlandUser: {
      id: string;
      sessions: {
        data: SessionNode[];
        listMetadata: { before: string | null; after: string | null };
      } | null;
    } | null;
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: {
        userId,
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
        ...(options.before ? { before: options.before } : {}),
        ...(options.after ? { after: options.after } : {}),
      },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (!data.userlandUser) {
    exitWithError({ code: 'not_found', message: `User "${userId}" was not found in this environment.` });
  }

  const sessions = (data.userlandUser.sessions?.data ?? []).map(shapeSession);
  const pagination = {
    before: data.userlandUser.sessions?.listMetadata?.before ?? null,
    after: data.userlandUser.sessions?.listMetadata?.after ?? null,
  };

  if (isJsonMode()) {
    outputJson({ sessions, pagination });
    return;
  }

  if (sessions.length === 0) {
    console.log('No sessions found.');
    return;
  }

  const rows = sessions.map((s) => [
    s.id,
    s.status ?? chalk.dim('-'),
    s.userAgent ?? chalk.dim('-'),
    s.ipAddress ?? chalk.dim('-'),
    s.createdAt ?? chalk.dim('-'),
    s.expiresAt ?? chalk.dim('-'),
  ]);
  console.log(
    formatTable(
      [
        { header: 'ID' },
        { header: 'Status' },
        { header: 'User Agent' },
        { header: 'IP Address' },
        { header: 'Created' },
        { header: 'Expires' },
      ],
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

export interface SessionRevokeOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runSessionRevoke(sessionId: string, options: SessionRevokeOptions = {}): Promise<void> {
  // Destructive per the manifest: the session can no longer authenticate.
  await confirmDestructive(options, {
    action: `revoke session ${sessionId} — it can no longer be used to sign in`,
  });

  const token = await requireCommandToken();
  const op = getOperation('revokeUserlandSession');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  // The operation's result selects only the success variant's sessionId (no
  // typename), so success is detected by its presence.
  let data: { revokeUserlandSession: { sessionId?: string } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { input: { sessionId } },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (!data.revokeUserlandSession?.sessionId) {
    exitWithError({
      code: 'revoke_failed',
      message: `Could not revoke session "${sessionId}". It may not exist or may already be revoked.`,
    });
  }

  if (isJsonMode()) {
    outputJson({ revoked: sessionId });
    return;
  }
  outputSuccess(`Revoked session ${chalk.bold(sessionId)}`);
}
