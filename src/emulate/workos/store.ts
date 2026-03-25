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
  WorkOSRefreshToken,
  WorkOSAuthenticationChallenge,
  WorkOSDeviceAuthorization,
  WorkOSInvitation,
  WorkOSRedirectUri,
  WorkOSCorsOrigin,
  WorkOSAuthorizedApplication,
  WorkOSConnectedAccount,
  WorkOSRole,
  WorkOSPermission,
  WorkOSRolePermission,
  WorkOSAuthorizationResource,
  WorkOSRoleAssignment,
  WorkOSDirectory,
  WorkOSDirectoryUser,
  WorkOSDirectoryGroup,
  WorkOSAuditLogAction,
  WorkOSAuditLogEvent,
  WorkOSAuditLogExport,
  WorkOSFeatureFlag,
  WorkOSFlagTarget,
  WorkOSConnectApplication,
  WorkOSClientSecret,
  WorkOSDataIntegrationAuth,
  WorkOSRadarAttempt,
  WorkOSApiKey,
  WorkOSEvent,
  WorkOSWebhookEndpoint,
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
  refreshTokens: Collection<WorkOSRefreshToken>;
  authChallenges: Collection<WorkOSAuthenticationChallenge>;
  deviceAuthorizations: Collection<WorkOSDeviceAuthorization>;
  invitations: Collection<WorkOSInvitation>;
  redirectUris: Collection<WorkOSRedirectUri>;
  corsOrigins: Collection<WorkOSCorsOrigin>;
  authorizedApplications: Collection<WorkOSAuthorizedApplication>;
  connectedAccounts: Collection<WorkOSConnectedAccount>;
  roles: Collection<WorkOSRole>;
  permissions: Collection<WorkOSPermission>;
  rolePermissions: Collection<WorkOSRolePermission>;
  authorizationResources: Collection<WorkOSAuthorizationResource>;
  roleAssignments: Collection<WorkOSRoleAssignment>;
  directories: Collection<WorkOSDirectory>;
  directoryUsers: Collection<WorkOSDirectoryUser>;
  directoryGroups: Collection<WorkOSDirectoryGroup>;
  auditLogActions: Collection<WorkOSAuditLogAction>;
  auditLogEvents: Collection<WorkOSAuditLogEvent>;
  auditLogExports: Collection<WorkOSAuditLogExport>;
  featureFlags: Collection<WorkOSFeatureFlag>;
  flagTargets: Collection<WorkOSFlagTarget>;
  connectApplications: Collection<WorkOSConnectApplication>;
  clientSecrets: Collection<WorkOSClientSecret>;
  dataIntegrationAuths: Collection<WorkOSDataIntegrationAuth>;
  radarAttempts: Collection<WorkOSRadarAttempt>;
  apiKeyRecords: Collection<WorkOSApiKey>;
  events: Collection<WorkOSEvent>;
  webhookEndpoints: Collection<WorkOSWebhookEndpoint>;
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
    refreshTokens: store.collection<WorkOSRefreshToken>('workos.refresh_tokens', 'ref', [
      'token',
      'user_id',
      'session_id',
    ]),
    authChallenges: store.collection<WorkOSAuthenticationChallenge>('workos.auth_challenges', 'auth_challenge', [
      'user_id',
      'factor_id',
    ]),
    deviceAuthorizations: store.collection<WorkOSDeviceAuthorization>('workos.device_authorizations', 'dev_auth', [
      'device_code',
      'user_code',
    ]),
    invitations: store.collection<WorkOSInvitation>('workos.invitations', 'inv', ['email', 'token', 'organization_id']),
    redirectUris: store.collection<WorkOSRedirectUri>('workos.redirect_uris', 'redir', ['uri']),
    corsOrigins: store.collection<WorkOSCorsOrigin>('workos.cors_origins', 'cors', ['origin']),
    authorizedApplications: store.collection<WorkOSAuthorizedApplication>(
      'workos.authorized_applications',
      'auth_app',
      ['user_id'],
    ),
    connectedAccounts: store.collection<WorkOSConnectedAccount>('workos.connected_accounts', 'conn_acct', [
      'user_id',
      'provider',
    ]),
    roles: store.collection<WorkOSRole>('workos.roles', 'role', ['slug', 'organization_id']),
    permissions: store.collection<WorkOSPermission>('workos.permissions', 'perm', ['slug']),
    rolePermissions: store.collection<WorkOSRolePermission>('workos.role_permissions', 'rp', [
      'role_id',
      'permission_id',
    ]),
    authorizationResources: store.collection<WorkOSAuthorizationResource>(
      'workos.authorization_resources',
      'auth_res',
      ['organization_id', 'resource_type_slug'],
    ),
    roleAssignments: store.collection<WorkOSRoleAssignment>('workos.role_assignments', 'ra', [
      'organization_membership_id',
      'role_id',
    ]),
    directories: store.collection<WorkOSDirectory>('workos.directories', 'directory', ['organization_id']),
    directoryUsers: store.collection<WorkOSDirectoryUser>('workos.directory_users', 'directory_user', [
      'directory_id',
      'organization_id',
    ]),
    directoryGroups: store.collection<WorkOSDirectoryGroup>('workos.directory_groups', 'directory_grp', [
      'directory_id',
      'organization_id',
    ]),
    auditLogActions: store.collection<WorkOSAuditLogAction>('workos.audit_log_actions', 'audit_action', ['name']),
    auditLogEvents: store.collection<WorkOSAuditLogEvent>('workos.audit_log_events', 'audit_event', [
      'organization_id',
    ]),
    auditLogExports: store.collection<WorkOSAuditLogExport>('workos.audit_log_exports', 'audit_export', [
      'organization_id',
    ]),
    featureFlags: store.collection<WorkOSFeatureFlag>('workos.feature_flags', 'ff', ['slug']),
    flagTargets: store.collection<WorkOSFlagTarget>('workos.flag_targets', 'ff_target', ['flag_slug', 'resource_id']),
    connectApplications: store.collection<WorkOSConnectApplication>('workos.connect_applications', 'connect_app', [
      'client_id',
    ]),
    clientSecrets: store.collection<WorkOSClientSecret>('workos.client_secrets', 'client_secret', ['application_id']),
    dataIntegrationAuths: store.collection<WorkOSDataIntegrationAuth>('workos.data_integration_auths', 'di_auth', [
      'code',
      'slug',
    ]),
    radarAttempts: store.collection<WorkOSRadarAttempt>('workos.radar_attempts', 'radar_attempt', ['ip_address']),
    apiKeyRecords: store.collection<WorkOSApiKey>('workos.api_keys', 'api_key', ['key', 'environment']),
    events: store.collection<WorkOSEvent>('workos.events', 'evt', ['event']),
    webhookEndpoints: store.collection<WorkOSWebhookEndpoint>('workos.webhook_endpoints', 'we', ['url']),
  };
}
