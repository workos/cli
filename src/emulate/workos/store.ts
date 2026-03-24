import { type Store, type Collection } from '../core/index.js';
import type {
  WorkOSOrganization,
  WorkOSOrganizationDomain,
  WorkOSOrganizationMembership,
  WorkOSUser,
  WorkOSSession,
  WorkOSEmailVerification,
  WorkOSPasswordReset,
  WorkOSMagicAuth,
  WorkOSAuthenticationFactor,
  WorkOSAuthorizationCode,
  WorkOSIdentity,
  WorkOSConnection,
  WorkOSSSOProfile,
  WorkOSSSOAuthorization,
  WorkOSPipeConnection,
} from './entities.js';

export interface WorkOSStore {
  organizations: Collection<WorkOSOrganization>;
  organizationDomains: Collection<WorkOSOrganizationDomain>;
  organizationMemberships: Collection<WorkOSOrganizationMembership>;
  users: Collection<WorkOSUser>;
  sessions: Collection<WorkOSSession>;
  emailVerifications: Collection<WorkOSEmailVerification>;
  passwordResets: Collection<WorkOSPasswordReset>;
  magicAuths: Collection<WorkOSMagicAuth>;
  authFactors: Collection<WorkOSAuthenticationFactor>;
  authCodes: Collection<WorkOSAuthorizationCode>;
  identities: Collection<WorkOSIdentity>;
  connections: Collection<WorkOSConnection>;
  ssoProfiles: Collection<WorkOSSSOProfile>;
  ssoAuthorizations: Collection<WorkOSSSOAuthorization>;
  pipeConnections: Collection<WorkOSPipeConnection>;
}

export function getWorkOSStore(store: Store): WorkOSStore {
  return {
    organizations: store.collection<WorkOSOrganization>('workos.organizations', 'org', ['name', 'external_id']),
    organizationDomains: store.collection<WorkOSOrganizationDomain>('workos.organization_domains', 'org_domain', [
      'organization_id',
      'domain',
    ]),
    organizationMemberships: store.collection<WorkOSOrganizationMembership>('workos.organization_memberships', 'om', [
      'organization_id',
      'user_id',
    ]),
    users: store.collection<WorkOSUser>('workos.users', 'user', ['email', 'external_id']),
    sessions: store.collection<WorkOSSession>('workos.sessions', 'session', ['user_id']),
    emailVerifications: store.collection<WorkOSEmailVerification>('workos.email_verifications', 'email_verification', [
      'user_id',
    ]),
    passwordResets: store.collection<WorkOSPasswordReset>('workos.password_resets', 'password_reset', ['user_id']),
    magicAuths: store.collection<WorkOSMagicAuth>('workos.magic_auths', 'magic_auth', ['user_id']),
    authFactors: store.collection<WorkOSAuthenticationFactor>('workos.auth_factors', 'auth_factor', ['user_id']),
    authCodes: store.collection<WorkOSAuthorizationCode>('workos.auth_codes', 'auth_code', ['user_id', 'code']),
    identities: store.collection<WorkOSIdentity>('workos.identities', 'identity', ['user_id']),
    connections: store.collection<WorkOSConnection>('workos.connections', 'conn', ['organization_id']),
    ssoProfiles: store.collection<WorkOSSSOProfile>('workos.sso_profiles', 'prof', ['connection_id', 'email']),
    ssoAuthorizations: store.collection<WorkOSSSOAuthorization>('workos.sso_authorizations', 'sso_auth', ['code']),
    pipeConnections: store.collection<WorkOSPipeConnection>('workos.pipe_connections', 'pipe_conn', [
      'user_id',
      'provider',
    ]),
  };
}
