/**
 * API-key adapters for `workos user` and `workos session`, backed by
 * `/user_management/users` and its sessions/memberships/auth-factor endpoints.
 *
 * Filled with extra reads: `identities` (the user's organization memberships,
 * with role IDs/names resolved from their slugs), `authenticationFactors`
 * (user get), and session organization names. No REST source, returned
 * `null`: `sessionCount`, `hasPassword`, `emailVerifiedAt` (REST has only a
 * verified boolean, kept internally for the human view), a factor's
 * `lastVerifiedAt`, a session impersonator's id/name, and an OAuth session's
 * provider.
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
import { metadataPairs } from './organizations.js';
import { findRole, mapLimit, membershipsForUser, organizationName, type RestMembership } from './lookups.js';

export interface RestUser {
  object?: 'user';
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  email_verified?: boolean;
  profile_picture_url?: string | null;
  last_sign_in_at?: string | null;
  locale?: string | null;
  external_id?: string | null;
  metadata?: Record<string, string> | null;
  created_at?: string;
  updated_at?: string;
}

interface RestSession {
  object?: 'session';
  id: string;
  impersonator?: { email: string; reason: string | null } | null;
  ip_address?: string | null;
  organization_id?: string | null;
  user_agent?: string | null;
  user_id?: string;
  auth_method?: string | null;
  status?: string | null;
  expires_at?: string | null;
  ended_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Concurrent per-user reads on a list page. */
const PER_USER_CONCURRENCY = 5;

function userNode(user: RestUser) {
  return {
    id: user.id,
    email: user.email ?? null,
    firstName: user.first_name ?? null,
    lastName: user.last_name ?? null,
    createdAt: user.created_at ?? null,
    emailVerifiedAt: null,
    // Not part of the `--json` shape: lets the human view say "Verified"
    // without inventing a verification timestamp.
    emailVerified: user.email_verified ?? null,
    lastSignedInAt: user.last_sign_in_at ?? null,
    sessionCount: null,
    hasPassword: null,
    locale: user.locale ?? null,
    externalId: user.external_id ?? null,
    profilePictureUrl: user.profile_picture_url ?? null,
    metadata: metadataPairs(user.metadata),
  };
}

/** A membership as a dashboard identity, role slugs resolved to `{ id, name }`. */
async function identityNode(ctx: ApiKeyContext, membership: RestMembership) {
  const slugs = (membership.roles?.length ? membership.roles : membership.role ? [membership.role] : []).map(
    (role) => role.slug,
  );
  const roles = await Promise.all(
    slugs.map(async (slug) => {
      const role = await findRole(ctx, { slug }, membership.organization_id);
      return { id: role?.id ?? null, name: role?.name ?? null };
    }),
  );
  return {
    id: membership.id,
    status: membership.status ?? null,
    organization: {
      id: membership.organization_id,
      name: membership.organization_name ?? (await organizationName(ctx, membership.organization_id)),
    },
    roles,
  };
}

async function identitiesFor(ctx: ApiKeyContext, userId: string) {
  const memberships = await membershipsForUser(ctx, userId);
  return { data: await Promise.all(memberships.map((membership) => identityNode(ctx, membership))) };
}

const SESSION_STATE: Record<string, (session: RestSession) => Record<string, unknown>> = {
  active: (s) => ({ __typename: 'UserlandSessionIssued', expiresAt: s.expires_at ?? null }),
  expired: (s) => ({ __typename: 'UserlandSessionExpired', endedAt: s.ended_at ?? null }),
  revoked: (s) => ({
    __typename: 'UserlandSessionRevoked',
    expiresAt: s.expires_at ?? null,
    endedAt: s.ended_at ?? null,
  }),
};

/**
 * REST `auth_method` → the dashboard's `SessionProvider` value (per the
 * vendored catalog), which the session shape passes through as-is. REST
 * reports every OAuth provider as plain `oauth`, so those (and `unknown`) have
 * no dashboard equivalent and come back null.
 */
const SESSION_PROVIDER: Record<string, string> = {
  cross_app_auth: 'CrossAppAuth',
  external_auth: 'ExternalAuth',
  impersonation: 'Impersonation',
  magic_code: 'MagicAuth',
  migrated_session: 'MigratedSession',
  passkey: 'Passkey',
  password: 'Password',
  sso: 'SingleSignOn',
};

function sessionProvider(method: string | null | undefined): string | null {
  return method ? (SESSION_PROVIDER[method] ?? null) : null;
}

async function sessionNode(ctx: ApiKeyContext, session: RestSession) {
  return {
    id: session.id,
    createdAt: session.created_at ?? null,
    updatedAt: session.updated_at ?? null,
    ipAddress: session.ip_address ?? null,
    userAgent: session.user_agent ?? null,
    provider: sessionProvider(session.auth_method),
    impersonator: session.impersonator
      ? { id: null, email: session.impersonator.email ?? null, firstName: null, lastName: null }
      : null,
    impersonationReason: session.impersonator?.reason ?? null,
    organization: session.organization_id
      ? { id: session.organization_id, name: await organizationName(ctx, session.organization_id) }
      : null,
    application: null,
    state: session.status ? (SESSION_STATE[session.status]?.(session) ?? null) : null,
  };
}

export const userOperations: Record<string, ApiKeyOperation> = {
  async userlandUsers(variables, ctx) {
    // `--email` is the CLI's only search input; REST filters by exact email.
    const page = await ctx.request<WorkOSListResponse<RestUser>>({
      method: 'GET',
      path: '/user_management/users',
      params: {
        limit: num(variables.limit),
        before: str(variables.before),
        after: str(variables.after),
        order: restOrder(variables.order),
        email: str(variables.search),
      },
    });
    const users = await mapLimit(page?.data ?? [], PER_USER_CONCURRENCY, async (user) => ({
      ...userNode(user),
      identities: await identitiesFor(ctx, user.id),
    }));
    return { userlandUsers: listEnvelope(users, page?.list_metadata) };
  },

  async userlandUser(variables, ctx) {
    const id = String(variables.id);
    const user = await orNull(ctx.request<RestUser>({ method: 'GET', path: `/user_management/users/${encode(id)}` }));
    if (!user) return { userlandUser: null };
    const [identities, factors] = await Promise.all([
      identitiesFor(ctx, id),
      ctx.request<{ data: Array<{ id: string }> }>({
        method: 'GET',
        path: `/user_management/users/${encode(id)}/auth_factors`,
      }),
    ]);
    return {
      userlandUser: {
        ...userNode(user),
        identities,
        authenticationFactors: (factors?.data ?? []).map((factor) => ({ id: factor.id, lastVerifiedAt: null })),
      },
    };
  },

  async updateUserlandUser(variables, ctx) {
    const input = (variables.input ?? {}) as Record<string, unknown>;
    const body: Record<string, unknown> = {};
    if (input.firstName !== undefined) body.first_name = input.firstName;
    if (input.lastName !== undefined) body.last_name = input.lastName;
    if (input.email !== undefined) body.email = input.email;
    if (input.locale !== undefined) body.locale = input.locale;
    if (input.externalId !== undefined) body.external_id = input.externalId;
    const user = await orNull(
      ctx.request<RestUser>({
        method: 'PUT',
        path: `/user_management/users/${encode(String(input.userlandUserId))}`,
        body,
      }),
    );
    if (!user) return { updateUserlandUser: { __typename: 'UserlandUserNotFound' } };
    return {
      updateUserlandUser: {
        __typename: 'UserlandUserUpdated',
        userlandUser: {
          id: user.id,
          email: user.email ?? null,
          firstName: user.first_name ?? null,
          lastName: user.last_name ?? null,
        },
      },
    };
  },

  async deleteUserlandUser(variables, ctx) {
    const { userlandUserId } = (variables.input ?? {}) as { userlandUserId?: unknown };
    const deleted = await orNull(
      ctx
        .request({ method: 'DELETE', path: `/user_management/users/${encode(String(userlandUserId))}` })
        .then(() => true),
    );
    return { deleteUserlandUser: { __typename: deleted ? 'UserlandUserDeleted' : 'UserlandUserNotFound' } };
  },

  // --- session ------------------------------------------------------------------

  async userlandSessions(variables, ctx) {
    const userId = String(variables.userId);
    const page = await orNull(
      ctx.request<WorkOSListResponse<RestSession>>({
        method: 'GET',
        path: `/user_management/users/${encode(userId)}/sessions`,
        params: {
          limit: num(variables.limit),
          before: str(variables.before),
          after: str(variables.after),
          order: restOrder(),
        },
      }),
    );
    if (!page) return { userlandUser: null };
    const sessions = await Promise.all((page.data ?? []).map((session) => sessionNode(ctx, session)));
    return { userlandUser: { id: userId, sessions: listEnvelope(sessions, page.list_metadata) } };
  },

  async revokeUserlandSession(variables, ctx) {
    const { sessionId } = (variables.input ?? {}) as { sessionId?: unknown };
    const revoked = await orNull(
      ctx
        .request({ method: 'POST', path: '/user_management/sessions/revoke', body: { session_id: sessionId } })
        .then(() => true),
    );
    return { revokeUserlandSession: revoked ? { sessionId } : null };
  },
};
