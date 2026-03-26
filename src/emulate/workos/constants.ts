/** Typed keys for Store.getData/setData */
export const STORE_KEYS = {
  workosStore: '_workos_store',
  eventBus: 'eventBus',
  apiKeyMap: 'apiKeyMap',
  jwtTemplate: 'jwt_template',
} as const;

/** Prefix for dynamic store keys */
export const STORE_KEY_PREFIXES = {
  pendingAuth: 'pending_auth:',
  ssoToken: 'sso_token:',
  ssoLogout: 'sso_logout:',
  auditSchema: 'audit_schema_',
  radarIpList: 'radar_ip_list',
} as const;

/** All WorkOS webhook event names */
export const EVENTS = {
  userCreated: 'user.created',
  userUpdated: 'user.updated',
  userDeleted: 'user.deleted',
  organizationCreated: 'organization.created',
  organizationUpdated: 'organization.updated',
  organizationDeleted: 'organization.deleted',
  organizationDomainCreated: 'organization_domain.created',
  organizationDomainVerified: 'organization_domain.verified',
  organizationDomainUpdated: 'organization_domain.updated',
  organizationDomainDeleted: 'organization_domain.deleted',
  organizationMembershipCreated: 'organization_membership.created',
  organizationMembershipUpdated: 'organization_membership.updated',
  organizationMembershipDeleted: 'organization_membership.deleted',
  connectionCreated: 'connection.created',
  connectionUpdated: 'connection.updated',
  connectionDeleted: 'connection.deleted',
  sessionCreated: 'session.created',
  sessionRevoked: 'session.revoked',
  invitationCreated: 'invitation.created',
  invitationAccepted: 'invitation.accepted',
  invitationRevoked: 'invitation.revoked',
  invitationResent: 'invitation.resent',
  roleCreated: 'role.created',
  roleUpdated: 'role.updated',
  roleDeleted: 'role.deleted',
  permissionCreated: 'permission.created',
  permissionUpdated: 'permission.updated',
  permissionDeleted: 'permission.deleted',
  directoryCreated: 'directory.created',
  directoryUpdated: 'directory.updated',
  directoryDeleted: 'directory.deleted',
  directoryUserCreated: 'directory_user.created',
  directoryUserUpdated: 'directory_user.updated',
  directoryUserDeleted: 'directory_user.deleted',
  directoryGroupCreated: 'directory_group.created',
  directoryGroupUpdated: 'directory_group.updated',
  directoryGroupDeleted: 'directory_group.deleted',
} as const;

export type WorkOSEventName = (typeof EVENTS)[keyof typeof EVENTS];
