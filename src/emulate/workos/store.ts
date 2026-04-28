import { type Store, type Collection, ID_PREFIXES } from '../core/index.js';
import { STORE_KEYS } from './constants.js';
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
  const cached = store.getData<WorkOSStore>(STORE_KEYS.workosStore);
  if (cached) return cached;

  const ws: WorkOSStore = {
    organizations: store.collection<WorkOSOrganization>('workos.organizations', ID_PREFIXES.organization, [
      'name',
      'external_id',
    ]),
    organizationDomains: store.collection<WorkOSOrganizationDomain>(
      'workos.organization_domains',
      ID_PREFIXES.organization_domain,
      ['organization_id', 'domain'],
    ),
    organizationMemberships: store.collection<WorkOSOrganizationMembership>(
      'workos.organization_memberships',
      ID_PREFIXES.organization_membership,
      ['organization_id', 'user_id'],
    ),
    users: store.collection<WorkOSUser>('workos.users', ID_PREFIXES.user, ['email', 'external_id']),
    sessions: store.collection<WorkOSSession>('workos.sessions', ID_PREFIXES.session, ['user_id']),
    emailVerifications: store.collection<WorkOSEmailVerification>(
      'workos.email_verifications',
      ID_PREFIXES.email_verification,
      ['user_id'],
    ),
    passwordResets: store.collection<WorkOSPasswordReset>('workos.password_resets', ID_PREFIXES.password_reset, [
      'user_id',
    ]),
    magicAuths: store.collection<WorkOSMagicAuth>('workos.magic_auths', ID_PREFIXES.magic_auth, ['user_id']),
    authFactors: store.collection<WorkOSAuthenticationFactor>(
      'workos.auth_factors',
      ID_PREFIXES.authentication_factor,
      ['user_id'],
    ),
    authCodes: store.collection<WorkOSAuthorizationCode>('workos.auth_codes', ID_PREFIXES.authorization_code, [
      'user_id',
      'code',
    ]),
    identities: store.collection<WorkOSIdentity>('workos.identities', ID_PREFIXES.identity, ['user_id']),
    connections: store.collection<WorkOSConnection>('workos.connections', ID_PREFIXES.connection, ['organization_id']),
    ssoProfiles: store.collection<WorkOSSSOProfile>('workos.sso_profiles', ID_PREFIXES.profile, [
      'connection_id',
      'email',
    ]),
    ssoAuthorizations: store.collection<WorkOSSSOAuthorization>(
      'workos.sso_authorizations',
      ID_PREFIXES.sso_authorization,
      ['code'],
    ),
    pipeConnections: store.collection<WorkOSPipeConnection>('workos.pipe_connections', ID_PREFIXES.pipe_connection, [
      'user_id',
      'provider',
    ]),
    refreshTokens: store.collection<WorkOSRefreshToken>('workos.refresh_tokens', ID_PREFIXES.refresh_token, [
      'token',
      'user_id',
      'session_id',
    ]),
    authChallenges: store.collection<WorkOSAuthenticationChallenge>(
      'workos.auth_challenges',
      ID_PREFIXES.authentication_challenge,
      ['user_id', 'factor_id'],
    ),
    deviceAuthorizations: store.collection<WorkOSDeviceAuthorization>(
      'workos.device_authorizations',
      ID_PREFIXES.device_authorization,
      ['device_code', 'user_code'],
    ),
    invitations: store.collection<WorkOSInvitation>('workos.invitations', ID_PREFIXES.invitation, [
      'email',
      'token',
      'organization_id',
    ]),
    redirectUris: store.collection<WorkOSRedirectUri>('workos.redirect_uris', ID_PREFIXES.redirect_uri, ['uri']),
    corsOrigins: store.collection<WorkOSCorsOrigin>('workos.cors_origins', ID_PREFIXES.cors_origin, ['origin']),
    authorizedApplications: store.collection<WorkOSAuthorizedApplication>(
      'workos.authorized_applications',
      ID_PREFIXES.authorized_application,
      ['user_id'],
    ),
    connectedAccounts: store.collection<WorkOSConnectedAccount>(
      'workos.connected_accounts',
      ID_PREFIXES.connected_account,
      ['user_id', 'provider'],
    ),
    roles: store.collection<WorkOSRole>('workos.roles', ID_PREFIXES.role, ['slug', 'organization_id']),
    permissions: store.collection<WorkOSPermission>('workos.permissions', ID_PREFIXES.permission, ['slug']),
    rolePermissions: store.collection<WorkOSRolePermission>('workos.role_permissions', ID_PREFIXES.role_permission, [
      'role_id',
      'permission_id',
    ]),
    authorizationResources: store.collection<WorkOSAuthorizationResource>(
      'workos.authorization_resources',
      ID_PREFIXES.authorization_resource,
      ['organization_id', 'resource_type_slug'],
    ),
    roleAssignments: store.collection<WorkOSRoleAssignment>('workos.role_assignments', ID_PREFIXES.role_assignment, [
      'organization_membership_id',
      'role_id',
    ]),
    directories: store.collection<WorkOSDirectory>('workos.directories', ID_PREFIXES.directory, ['organization_id']),
    directoryUsers: store.collection<WorkOSDirectoryUser>('workos.directory_users', ID_PREFIXES.directory_user, [
      'directory_id',
      'organization_id',
    ]),
    directoryGroups: store.collection<WorkOSDirectoryGroup>('workos.directory_groups', ID_PREFIXES.directory_group, [
      'directory_id',
      'organization_id',
    ]),
    auditLogActions: store.collection<WorkOSAuditLogAction>('workos.audit_log_actions', ID_PREFIXES.audit_log_action, [
      'name',
    ]),
    auditLogEvents: store.collection<WorkOSAuditLogEvent>('workos.audit_log_events', ID_PREFIXES.audit_log_event, [
      'organization_id',
    ]),
    auditLogExports: store.collection<WorkOSAuditLogExport>('workos.audit_log_exports', ID_PREFIXES.audit_log_export, [
      'organization_id',
    ]),
    featureFlags: store.collection<WorkOSFeatureFlag>('workos.feature_flags', ID_PREFIXES.feature_flag, ['slug']),
    flagTargets: store.collection<WorkOSFlagTarget>('workos.flag_targets', ID_PREFIXES.flag_target, [
      'flag_slug',
      'resource_id',
    ]),
    connectApplications: store.collection<WorkOSConnectApplication>(
      'workos.connect_applications',
      ID_PREFIXES.connect_application,
      ['client_id'],
    ),
    clientSecrets: store.collection<WorkOSClientSecret>('workos.client_secrets', ID_PREFIXES.client_secret, [
      'application_id',
    ]),
    dataIntegrationAuths: store.collection<WorkOSDataIntegrationAuth>(
      'workos.data_integration_auths',
      ID_PREFIXES.data_integration_auth,
      ['code', 'slug'],
    ),
    radarAttempts: store.collection<WorkOSRadarAttempt>('workos.radar_attempts', ID_PREFIXES.radar_attempt, [
      'ip_address',
    ]),
    apiKeyRecords: store.collection<WorkOSApiKey>('workos.api_keys', ID_PREFIXES.api_key, ['key', 'environment']),
    events: store.collection<WorkOSEvent>('workos.events', ID_PREFIXES.event, ['event']),
    webhookEndpoints: store.collection<WorkOSWebhookEndpoint>(
      'workos.webhook_endpoints',
      ID_PREFIXES.webhook_endpoint,
      ['endpoint_url'],
    ),
  };

  store.setData(STORE_KEYS.workosStore, ws);
  return ws;
}
