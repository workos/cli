import { randomBytes } from 'node:crypto';
import type { ServicePlugin, Store, RouteContext } from '../core/index.js';
import { generateId } from '../core/index.js';
import { getWorkOSStore, type WorkOSStore } from './store.js';
import { organizationRoutes } from './routes/organizations.js';
import { organizationDomainRoutes } from './routes/organization-domains.js';
import { membershipRoutes } from './routes/memberships.js';
import { userRoutes } from './routes/users.js';
import { emailVerificationRoutes } from './routes/email-verification.js';
import { passwordResetRoutes } from './routes/password-reset.js';
import { magicAuthRoutes } from './routes/magic-auth.js';
import { authFactorRoutes } from './routes/auth-factors.js';
import { sessionRoutes } from './routes/sessions.js';
import { authRoutes } from './routes/auth.js';
import { connectionRoutes } from './routes/connections.js';
import { ssoRoutes } from './routes/sso.js';
import { pipeRoutes } from './routes/pipes.js';
import { authChallengeRoutes } from './routes/auth-challenges.js';
import { invitationRoutes } from './routes/invitations.js';
import { configRoutes } from './routes/config.js';
import { userFeatureRoutes } from './routes/user-features.js';
import { widgetRoutes } from './routes/widgets.js';
import { authorizationRoleRoutes } from './routes/authorization-roles.js';
import { authorizationPermissionRoutes } from './routes/authorization-permissions.js';
import { authorizationOrgRoleRoutes } from './routes/authorization-org-roles.js';
import { authorizationResourceRoutes } from './routes/authorization-resources.js';
import { authorizationCheckRoutes } from './routes/authorization-checks.js';
import { portalRoutes } from './routes/portal.js';
import { legacyMfaRoutes } from './routes/legacy-mfa.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { radarRoutes } from './routes/radar.js';
import { connectRoutes } from './routes/connect.js';
import { directoryRoutes } from './routes/directories.js';
import { auditLogRoutes } from './routes/audit-logs.js';
import { featureFlagRoutes } from './routes/feature-flags.js';
import { dataIntegrationRoutes } from './routes/data-integrations.js';
import { webhookEndpointRoutes } from './routes/webhook-endpoints.js';
import { eventRoutes } from './routes/events.js';
import { EventBus } from './event-bus.js';
import { STORE_KEYS, EVENTS } from './constants.js';
import {
  generateVerificationToken,
  hashPassword,
  expiresIn,
  formatUser,
  formatOrganization,
  formatMembership,
  formatConnection,
  formatSession,
  formatInvitation,
  formatRole,
  formatPermission,
  formatDirectory,
  formatDirectoryUser,
  formatDirectoryGroup,
  formatDomain,
} from './helpers.js';
import type { WorkOSConnectionType, PipeProvider, PipeConnectionStatus } from './entities.js';

export { getWorkOSStore, type WorkOSStore } from './store.js';
export * from './entities.js';

export interface WorkOSSeedOrganization {
  name: string;
  external_id?: string;
  metadata?: Record<string, string>;
  domains?: Array<{ domain: string; state?: 'verified' | 'pending' }>;
  memberships?: Array<{
    user_id: string;
    role?: string;
    status?: 'active' | 'inactive' | 'pending';
  }>;
}

export interface WorkOSSeedUser {
  email: string;
  first_name?: string;
  last_name?: string;
  password?: string;
  email_verified?: boolean;
  external_id?: string;
  metadata?: Record<string, string>;
  impersonator?: { email: string; reason: string };
}

export interface WorkOSSeedConnection {
  name: string;
  connection_type?: WorkOSConnectionType;
  organization: string;
  state?: 'active' | 'inactive' | 'validating';
  domains?: string[];
  profiles?: Array<{
    email: string;
    first_name?: string;
    last_name?: string;
    idp_id?: string;
    groups?: string[];
  }>;
}

export interface WorkOSSeedPipeConnection {
  user_id: string;
  provider: PipeProvider;
  scopes: string[];
  status?: PipeConnectionStatus;
  external_account_id?: string;
}

export interface WorkOSSeedInvitation {
  email: string;
  organization_id?: string;
  inviter_user_id?: string;
  role_slug?: string;
}

export interface WorkOSSeedRole {
  slug: string;
  name: string;
  description?: string;
  type?: 'EnvironmentRole' | 'OrganizationRole';
  organization_id?: string;
  is_default_role?: boolean;
  priority?: number;
  permissions?: string[];
}

export interface WorkOSSeedPermission {
  slug: string;
  name: string;
  description?: string;
}

export interface WorkOSSeedWebhookEndpoint {
  endpoint_url?: string;
  /** @deprecated Use endpoint_url */
  url?: string;
  events?: string[];
  enabled?: boolean;
}

export interface WorkOSSeedConfig {
  organizations?: WorkOSSeedOrganization[];
  users?: WorkOSSeedUser[];
  connections?: WorkOSSeedConnection[];
  pipeConnections?: WorkOSSeedPipeConnection[];
  invitations?: WorkOSSeedInvitation[];
  roles?: WorkOSSeedRole[];
  permissions?: WorkOSSeedPermission[];
  webhookEndpoints?: WorkOSSeedWebhookEndpoint[];
}

export function seedFromConfig(store: Store, _baseUrl: string, config: WorkOSSeedConfig): void {
  const ws = getWorkOSStore(store);

  if (config.users) {
    for (const userConfig of config.users) {
      ws.users.insert({
        object: 'user',
        email: userConfig.email,
        first_name: userConfig.first_name ?? null,
        last_name: userConfig.last_name ?? null,
        email_verified: userConfig.email_verified ?? false,
        profile_picture_url: null,
        last_sign_in_at: null,
        external_id: userConfig.external_id ?? null,
        metadata: userConfig.metadata ?? {},
        locale: null,
        password_hash: userConfig.password ? hashPassword(userConfig.password) : null,
        impersonator: userConfig.impersonator ?? null,
      });
    }
  }

  if (config.organizations) {
    for (const orgConfig of config.organizations) {
      const org = ws.organizations.insert({
        object: 'organization',
        name: orgConfig.name,
        external_id: orgConfig.external_id ?? null,
        metadata: orgConfig.metadata ?? {},
        stripe_customer_id: null,
      });

      if (orgConfig.domains) {
        for (const dd of orgConfig.domains) {
          ws.organizationDomains.insert({
            object: 'organization_domain',
            organization_id: org.id,
            domain: dd.domain,
            state: dd.state ?? 'pending',
            verification_strategy: 'manual',
            verification_token: generateVerificationToken(),
            verification_prefix: 'workos-verify',
          });
        }
      }

      if (orgConfig.memberships) {
        for (const mm of orgConfig.memberships) {
          ws.organizationMemberships.insert({
            object: 'organization_membership',
            organization_id: org.id,
            user_id: mm.user_id,
            role: { slug: mm.role ?? 'member' },
            status: mm.status ?? 'active',
            external_id: null,
            metadata: {},
          });
        }
      }
    }
  }

  if (config.connections) {
    for (const connConfig of config.connections) {
      const org = ws.organizations.findOneBy('name', connConfig.organization);
      if (!org) continue;

      const domains = (connConfig.domains ?? []).map((d) => ({
        object: 'connection_domain' as const,
        id: generateId('conn_domain'),
        domain: d,
      }));

      const conn = ws.connections.insert({
        object: 'connection',
        organization_id: org.id,
        connection_type: connConfig.connection_type ?? 'GenericSAML',
        name: connConfig.name,
        state: connConfig.state ?? 'active',
        domains,
      });

      if (connConfig.profiles) {
        for (const p of connConfig.profiles) {
          ws.ssoProfiles.insert({
            object: 'profile',
            connection_id: conn.id,
            connection_type: conn.connection_type,
            organization_id: org.id,
            idp_id: p.idp_id ?? `idp_${generateId('usr')}`,
            email: p.email,
            first_name: p.first_name ?? null,
            last_name: p.last_name ?? null,
            groups: p.groups ?? [],
            raw_attributes: { email: p.email },
          });
        }
      }
    }
  }

  if (config.pipeConnections) {
    for (const pc of config.pipeConnections) {
      ws.pipeConnections.insert({
        object: 'pipe_connection',
        user_id: pc.user_id,
        provider: pc.provider,
        scopes: pc.scopes,
        status: pc.status ?? 'connected',
        external_account_id: pc.external_account_id ?? null,
      });
    }
  }

  if (config.permissions) {
    for (const permConfig of config.permissions) {
      ws.permissions.insert({
        object: 'permission',
        slug: permConfig.slug,
        name: permConfig.name,
        description: permConfig.description ?? null,
      });
    }
  }

  if (config.roles) {
    for (const roleConfig of config.roles) {
      const role = ws.roles.insert({
        object: 'role',
        slug: roleConfig.slug,
        name: roleConfig.name,
        description: roleConfig.description ?? null,
        type: roleConfig.type ?? 'EnvironmentRole',
        organization_id: roleConfig.organization_id ?? null,
        is_default_role: roleConfig.is_default_role ?? false,
        priority: roleConfig.priority ?? 0,
      });

      if (roleConfig.permissions) {
        for (const permSlug of roleConfig.permissions) {
          const perm = ws.permissions.findOneBy('slug', permSlug);
          if (perm) {
            ws.rolePermissions.insert({ role_id: role.id, permission_id: perm.id });
          }
        }
      }
    }
  }

  if (config.invitations) {
    for (const invConfig of config.invitations) {
      const token = generateVerificationToken();
      ws.invitations.insert({
        object: 'invitation',
        email: invConfig.email,
        state: 'pending',
        token,
        accept_invitation_url: `${_baseUrl}/user_management/invitations/accept?token=${token}`,
        organization_id: invConfig.organization_id ?? null,
        inviter_user_id: invConfig.inviter_user_id ?? null,
        role_slug: invConfig.role_slug ?? null,
        expires_at: expiresIn(72 * 60),
      });
    }
  }

  if (config.webhookEndpoints) {
    for (const whConfig of config.webhookEndpoints) {
      const endpointUrl = whConfig.endpoint_url ?? whConfig.url;
      if (!endpointUrl || typeof endpointUrl !== 'string') {
        throw new Error('workos seed config: webhookEndpoints[].endpoint_url is required');
      }
      ws.webhookEndpoints.insert({
        object: 'webhook_endpoint',
        endpoint_url: endpointUrl,
        secret: randomBytes(32).toString('hex'),
        enabled: whConfig.enabled !== false,
        events: whConfig.events ?? [],
        description: null,
      });
    }
  }
}

export const workosPlugin: ServicePlugin = {
  name: 'workos',
  register(ctx: RouteContext): void {
    organizationRoutes(ctx);
    organizationDomainRoutes(ctx);
    membershipRoutes(ctx);
    userRoutes(ctx);
    emailVerificationRoutes(ctx);
    passwordResetRoutes(ctx);
    magicAuthRoutes(ctx);
    authFactorRoutes(ctx);
    authChallengeRoutes(ctx);
    sessionRoutes(ctx);
    authRoutes(ctx);
    connectionRoutes(ctx);
    ssoRoutes(ctx);
    pipeRoutes(ctx);
    invitationRoutes(ctx);
    configRoutes(ctx);
    userFeatureRoutes(ctx);
    widgetRoutes(ctx);
    authorizationRoleRoutes(ctx);
    authorizationPermissionRoutes(ctx);
    authorizationOrgRoleRoutes(ctx);
    authorizationResourceRoutes(ctx);
    authorizationCheckRoutes(ctx);
    portalRoutes(ctx);
    legacyMfaRoutes(ctx);
    apiKeyRoutes(ctx);
    radarRoutes(ctx);
    connectRoutes(ctx);
    directoryRoutes(ctx);
    auditLogRoutes(ctx);
    featureFlagRoutes(ctx);
    dataIntegrationRoutes(ctx);
    webhookEndpointRoutes(ctx);
    eventRoutes(ctx);

    // Set up event bus with collection hooks (Option A from spec)
    // Store on ctx.store for route-level access (hybrid Option A+B for action events)
    const eventBus = new EventBus(ctx.store);
    ctx.store.setData(STORE_KEYS.eventBus, eventBus);
    const ws = getWorkOSStore(ctx.store);

    ws.users.setHooks({
      onInsert: (u) => eventBus.emit({ event: EVENTS.userCreated, data: formatUser(u) }),
      onUpdate: (u) => eventBus.emit({ event: EVENTS.userUpdated, data: formatUser(u) }),
      onDelete: (u) => eventBus.emit({ event: EVENTS.userDeleted, data: formatUser(u) }),
    });
    ws.organizations.setHooks({
      onInsert: (o) => eventBus.emit({ event: EVENTS.organizationCreated, data: formatOrganization(o, ws) }),
      onUpdate: (o) => eventBus.emit({ event: EVENTS.organizationUpdated, data: formatOrganization(o, ws) }),
      onDelete: (o) => eventBus.emit({ event: EVENTS.organizationDeleted, data: formatOrganization(o, ws) }),
    });
    ws.organizationDomains.setHooks({
      onInsert: (d) => eventBus.emit({ event: EVENTS.organizationDomainCreated, data: formatDomain(d) }),
      onUpdate: (d) =>
        eventBus.emit({
          event: d.state === 'verified' ? EVENTS.organizationDomainVerified : EVENTS.organizationDomainUpdated,
          data: formatDomain(d),
        }),
      onDelete: (d) => eventBus.emit({ event: EVENTS.organizationDomainDeleted, data: formatDomain(d) }),
    });
    ws.organizationMemberships.setHooks({
      onInsert: (m) => eventBus.emit({ event: EVENTS.organizationMembershipCreated, data: formatMembership(m) }),
      onUpdate: (m) => eventBus.emit({ event: EVENTS.organizationMembershipUpdated, data: formatMembership(m) }),
      onDelete: (m) => eventBus.emit({ event: EVENTS.organizationMembershipDeleted, data: formatMembership(m) }),
    });
    ws.connections.setHooks({
      onInsert: (c) => eventBus.emit({ event: EVENTS.connectionCreated, data: formatConnection(c) }),
      onUpdate: (c) => eventBus.emit({ event: EVENTS.connectionUpdated, data: formatConnection(c) }),
      onDelete: (c) => eventBus.emit({ event: EVENTS.connectionDeleted, data: formatConnection(c) }),
    });
    ws.sessions.setHooks({
      onInsert: (s) => eventBus.emit({ event: EVENTS.sessionCreated, data: formatSession(s) }),
      onDelete: (s) => eventBus.emit({ event: EVENTS.sessionRevoked, data: formatSession(s) }),
    });
    ws.invitations.setHooks({
      onInsert: (i) => eventBus.emit({ event: EVENTS.invitationCreated, data: formatInvitation(i) }),
    });
    ws.roles.setHooks({
      onInsert: (r) => eventBus.emit({ event: EVENTS.roleCreated, data: formatRole(r) }),
      onUpdate: (r) => eventBus.emit({ event: EVENTS.roleUpdated, data: formatRole(r) }),
      onDelete: (r) => eventBus.emit({ event: EVENTS.roleDeleted, data: formatRole(r) }),
    });
    ws.permissions.setHooks({
      onInsert: (p) => eventBus.emit({ event: EVENTS.permissionCreated, data: formatPermission(p) }),
      onUpdate: (p) => eventBus.emit({ event: EVENTS.permissionUpdated, data: formatPermission(p) }),
      onDelete: (p) => eventBus.emit({ event: EVENTS.permissionDeleted, data: formatPermission(p) }),
    });
    ws.directories.setHooks({
      onInsert: (d) => eventBus.emit({ event: EVENTS.directoryCreated, data: formatDirectory(d) }),
      onUpdate: (d) => eventBus.emit({ event: EVENTS.directoryUpdated, data: formatDirectory(d) }),
      onDelete: (d) => eventBus.emit({ event: EVENTS.directoryDeleted, data: formatDirectory(d) }),
    });
    ws.directoryUsers.setHooks({
      onInsert: (u) => eventBus.emit({ event: EVENTS.directoryUserCreated, data: formatDirectoryUser(u) }),
      onUpdate: (u) => eventBus.emit({ event: EVENTS.directoryUserUpdated, data: formatDirectoryUser(u) }),
      onDelete: (u) => eventBus.emit({ event: EVENTS.directoryUserDeleted, data: formatDirectoryUser(u) }),
    });
    ws.directoryGroups.setHooks({
      onInsert: (g) => eventBus.emit({ event: EVENTS.directoryGroupCreated, data: formatDirectoryGroup(g) }),
      onUpdate: (g) => eventBus.emit({ event: EVENTS.directoryGroupUpdated, data: formatDirectoryGroup(g) }),
      onDelete: (g) => eventBus.emit({ event: EVENTS.directoryGroupDeleted, data: formatDirectoryGroup(g) }),
    });
    ws.webhookEndpoints.setHooks({
      onInsert: () => eventBus.rebuildIndex(),
      onUpdate: () => eventBus.rebuildIndex(),
      onDelete: () => eventBus.rebuildIndex(),
    });
  },
  seed(_store: Store, _baseUrl: string): void {
    // No default seed data — users provide their own via seedFromConfig
  },
};

export default workosPlugin;
