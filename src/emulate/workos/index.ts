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
import { generateVerificationToken, hashPassword } from './helpers.js';
import type { WorkOSConnectionType } from './entities.js';

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

export interface WorkOSSeedConfig {
  organizations?: WorkOSSeedOrganization[];
  users?: WorkOSSeedUser[];
  connections?: WorkOSSeedConnection[];
}

function seedDefaults(_store: Store, _baseUrl: string): void {
  // No default seed data — users provide their own via config
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
    sessionRoutes(ctx);
    authRoutes(ctx);
    connectionRoutes(ctx);
    ssoRoutes(ctx);
  },
  seed(store: Store, baseUrl: string): void {
    seedDefaults(store, baseUrl);
  },
};

export default workosPlugin;
