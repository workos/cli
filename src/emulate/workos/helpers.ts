import { randomBytes, createHash, createCipheriv } from 'node:crypto';
import { WorkOSApiError } from '../core/index.js';
import type { WorkOSStore } from './store.js';
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
  WorkOSIdentity,
  WorkOSConnection,
  WorkOSSSOProfile,
  WorkOSPipeConnection,
  WorkOSInvitation,
  WorkOSRedirectUri,
  WorkOSCorsOrigin,
  WorkOSAuthorizedApplication,
  WorkOSConnectedAccount,
  WorkOSAuthenticationChallenge,
  WorkOSDeviceAuthorization,
  WorkOSRole,
  WorkOSPermission,
  WorkOSAuthorizationResource,
  WorkOSRoleAssignment,
  WorkOSDirectory,
  WorkOSDirectoryUser,
  WorkOSDirectoryGroup,
  WorkOSAuditLogAction,
  WorkOSAuditLogEvent,
  WorkOSAuditLogExport,
  WorkOSFeatureFlag,
  WorkOSConnectApplication,
  WorkOSClientSecret,
  WorkOSRadarAttempt,
  WorkOSApiKey,
  WorkOSEvent,
  WorkOSWebhookEndpoint,
} from './entities.js';

export function formatOrganization(org: WorkOSOrganization, ws: WorkOSStore): Record<string, unknown> {
  const domains = ws.organizationDomains.findBy('organization_id', org.id).map(formatDomain);

  return {
    object: 'organization',
    id: org.id,
    name: org.name,
    external_id: org.external_id,
    metadata: org.metadata,
    domains,
    stripe_customer_id: org.stripe_customer_id,
    created_at: org.created_at,
    updated_at: org.updated_at,
  };
}

export function formatDomain(domain: WorkOSOrganizationDomain): Record<string, unknown> {
  return {
    object: 'organization_domain',
    id: domain.id,
    organization_id: domain.organization_id,
    domain: domain.domain,
    state: domain.state,
    verification_strategy: domain.verification_strategy,
    verification_token: domain.verification_token,
    verification_prefix: domain.verification_prefix,
    created_at: domain.created_at,
    updated_at: domain.updated_at,
  };
}

export function formatMembership(m: WorkOSOrganizationMembership): Record<string, unknown> {
  return {
    object: 'organization_membership',
    id: m.id,
    organization_id: m.organization_id,
    user_id: m.user_id,
    role: m.role,
    status: m.status,
    external_id: m.external_id,
    metadata: m.metadata,
    created_at: m.created_at,
    updated_at: m.updated_at,
  };
}

export function formatUser(user: WorkOSUser): Record<string, unknown> {
  return {
    object: 'user',
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    email_verified: user.email_verified,
    profile_picture_url: user.profile_picture_url,
    last_sign_in_at: user.last_sign_in_at,
    external_id: user.external_id,
    metadata: user.metadata,
    locale: user.locale,
    created_at: user.created_at,
    updated_at: user.updated_at,
  };
}

export function formatSession(s: WorkOSSession): Record<string, unknown> {
  return {
    object: 'session',
    id: s.id,
    user_id: s.user_id,
    organization_id: s.organization_id,
    ip_address: s.ip_address,
    user_agent: s.user_agent,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export function formatEmailVerification(ev: WorkOSEmailVerification): Record<string, unknown> {
  return {
    object: 'email_verification',
    id: ev.id,
    user_id: ev.user_id,
    email: ev.email,
    code: ev.code,
    expires_at: ev.expires_at,
    created_at: ev.created_at,
    updated_at: ev.updated_at,
  };
}

export function formatPasswordReset(pr: WorkOSPasswordReset): Record<string, unknown> {
  return {
    object: 'password_reset',
    id: pr.id,
    user_id: pr.user_id,
    email: pr.email,
    token: pr.token,
    expires_at: pr.expires_at,
    created_at: pr.created_at,
    updated_at: pr.updated_at,
  };
}

export function formatMagicAuth(ma: WorkOSMagicAuth): Record<string, unknown> {
  return {
    object: 'magic_auth',
    id: ma.id,
    user_id: ma.user_id,
    email: ma.email,
    code: ma.code,
    expires_at: ma.expires_at,
    created_at: ma.created_at,
    updated_at: ma.updated_at,
  };
}

export function formatAuthFactor(f: WorkOSAuthenticationFactor): Record<string, unknown> {
  return {
    object: 'authentication_factor',
    id: f.id,
    user_id: f.user_id,
    type: f.type,
    totp: f.totp,
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
}

export function formatIdentity(i: WorkOSIdentity): Record<string, unknown> {
  return {
    object: 'identity',
    id: i.id,
    user_id: i.user_id,
    provider: i.provider,
    provider_id: i.provider_id,
    type: i.type,
    created_at: i.created_at,
    updated_at: i.updated_at,
  };
}

export function generateVerificationToken(): string {
  return randomBytes(16).toString('hex');
}

export function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function expiresIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

export function isExpired(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() < Date.now();
}

export function formatConnection(conn: WorkOSConnection): Record<string, unknown> {
  return {
    object: 'connection',
    id: conn.id,
    organization_id: conn.organization_id,
    connection_type: conn.connection_type,
    name: conn.name,
    state: conn.state,
    domains: conn.domains,
    created_at: conn.created_at,
    updated_at: conn.updated_at,
  };
}

export function formatSSOProfile(p: WorkOSSSOProfile): Record<string, unknown> {
  return {
    object: 'profile',
    id: p.id,
    connection_id: p.connection_id,
    connection_type: p.connection_type,
    organization_id: p.organization_id,
    idp_id: p.idp_id,
    email: p.email,
    first_name: p.first_name,
    last_name: p.last_name,
    groups: p.groups,
    raw_attributes: p.raw_attributes,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export function formatPipeConnection(pc: WorkOSPipeConnection): Record<string, unknown> {
  return {
    object: 'pipe_connection',
    id: pc.id,
    user_id: pc.user_id,
    provider: pc.provider,
    scopes: pc.scopes,
    status: pc.status,
    external_account_id: pc.external_account_id,
    created_at: pc.created_at,
    updated_at: pc.updated_at,
  };
}

export function formatInvitation(inv: WorkOSInvitation): Record<string, unknown> {
  return {
    object: 'invitation',
    id: inv.id,
    email: inv.email,
    state: inv.state,
    token: inv.token,
    accept_invitation_url: inv.accept_invitation_url,
    organization_id: inv.organization_id,
    inviter_user_id: inv.inviter_user_id,
    role_slug: inv.role_slug,
    expires_at: inv.expires_at,
    created_at: inv.created_at,
    updated_at: inv.updated_at,
  };
}

export function formatRedirectUri(r: WorkOSRedirectUri): Record<string, unknown> {
  return {
    object: 'redirect_uri',
    id: r.id,
    uri: r.uri,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function formatCorsOrigin(o: WorkOSCorsOrigin): Record<string, unknown> {
  return {
    object: 'cors_origin',
    id: o.id,
    origin: o.origin,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}

export function formatAuthorizedApplication(a: WorkOSAuthorizedApplication): Record<string, unknown> {
  return {
    object: 'authorized_application',
    id: a.id,
    user_id: a.user_id,
    name: a.name,
    redirect_uri: a.redirect_uri,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function formatConnectedAccount(a: WorkOSConnectedAccount): Record<string, unknown> {
  return {
    object: 'connected_account',
    id: a.id,
    user_id: a.user_id,
    provider: a.provider,
    provider_id: a.provider_id,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function parseListParams(url: URL) {
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '10'), 100));
  const order = (url.searchParams.get('order') as 'asc' | 'desc') ?? 'desc';
  const before = url.searchParams.get('before') ?? undefined;
  const after = url.searchParams.get('after') ?? undefined;
  return { limit, order, before, after };
}

/** Allowed redirect URI hosts for the emulator's authorize endpoints. */
const ALLOWED_REDIRECT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Validate that a redirect_uri points to a localhost origin.
 * Prevents the emulator from being used as an open redirect.
 */
export function assertLocalRedirectUri(uri: string): void {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new WorkOSApiError(400, 'Invalid redirect_uri', 'invalid_redirect_uri');
  }
  if (!ALLOWED_REDIRECT_HOSTS.has(parsed.hostname)) {
    throw new WorkOSApiError(
      400,
      `redirect_uri must point to localhost, got ${parsed.hostname}`,
      'invalid_redirect_uri',
    );
  }
}

export function formatAuthChallenge(c: WorkOSAuthenticationChallenge): Record<string, unknown> {
  return {
    object: 'authentication_challenge',
    id: c.id,
    user_id: c.user_id,
    factor_id: c.factor_id,
    expires_at: c.expires_at,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}

export function formatRole(role: WorkOSRole): Record<string, unknown> {
  return {
    object: 'role',
    id: role.id,
    slug: role.slug,
    name: role.name,
    description: role.description,
    type: role.type,
    organization_id: role.organization_id,
    is_default_role: role.is_default_role,
    priority: role.priority,
    created_at: role.created_at,
    updated_at: role.updated_at,
  };
}

export function formatPermission(p: WorkOSPermission): Record<string, unknown> {
  return {
    object: 'permission',
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}

export function formatAuthorizationResource(r: WorkOSAuthorizationResource): Record<string, unknown> {
  return {
    object: 'authorization_resource',
    id: r.id,
    resource_type_slug: r.resource_type_slug,
    external_id: r.external_id,
    organization_id: r.organization_id,
    metadata: r.metadata,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

export function formatRoleAssignment(ra: WorkOSRoleAssignment): Record<string, unknown> {
  return {
    object: 'role_assignment',
    id: ra.id,
    organization_membership_id: ra.organization_membership_id,
    role_id: ra.role_id,
    created_at: ra.created_at,
    updated_at: ra.updated_at,
  };
}

export function formatDeviceAuthorization(d: WorkOSDeviceAuthorization): Record<string, unknown> {
  return {
    device_code: d.device_code,
    user_code: d.user_code,
    verification_uri: 'http://localhost:0/user_management/authorize/device/verify',
    expires_in: Math.max(0, Math.floor((new Date(d.expires_at).getTime() - Date.now()) / 1000)),
    interval: d.interval,
  };
}

// --- Phase 4: CRUD Domain formatters ---

export function formatDirectory(d: WorkOSDirectory): Record<string, unknown> {
  return {
    object: 'directory',
    id: d.id,
    name: d.name,
    organization_id: d.organization_id,
    domain: d.domain,
    type: d.type,
    state: d.state,
    external_key: d.external_key,
    created_at: d.created_at,
    updated_at: d.updated_at,
  };
}

export function formatDirectoryUser(u: WorkOSDirectoryUser): Record<string, unknown> {
  return {
    object: 'directory_user',
    id: u.id,
    directory_id: u.directory_id,
    organization_id: u.organization_id,
    idp_id: u.idp_id,
    first_name: u.first_name,
    last_name: u.last_name,
    email: u.email,
    username: u.username,
    state: u.state,
    role: u.role,
    custom_attributes: u.custom_attributes,
    raw_attributes: u.raw_attributes,
    groups: u.groups,
    created_at: u.created_at,
    updated_at: u.updated_at,
  };
}

export function formatDirectoryGroup(g: WorkOSDirectoryGroup): Record<string, unknown> {
  return {
    object: 'directory_group',
    id: g.id,
    directory_id: g.directory_id,
    organization_id: g.organization_id,
    idp_id: g.idp_id,
    name: g.name,
    raw_attributes: g.raw_attributes,
    created_at: g.created_at,
    updated_at: g.updated_at,
  };
}

export function formatAuditLogAction(a: WorkOSAuditLogAction): Record<string, unknown> {
  return {
    object: 'audit_log_action',
    id: a.id,
    name: a.name,
    description: a.description,
    condition: a.condition,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function formatAuditLogEvent(e: WorkOSAuditLogEvent): Record<string, unknown> {
  return {
    object: 'audit_log_event',
    id: e.id,
    organization_id: e.organization_id,
    action: e.action,
    actor: e.actor,
    targets: e.targets,
    metadata: e.metadata,
    occurred_at: e.occurred_at,
    created_at: e.created_at,
    updated_at: e.updated_at,
  };
}

export function formatAuditLogExport(ex: WorkOSAuditLogExport): Record<string, unknown> {
  return {
    object: 'audit_log_export',
    id: ex.id,
    organization_id: ex.organization_id,
    state: ex.state,
    url: ex.url,
    filters: ex.filters,
    created_at: ex.created_at,
    updated_at: ex.updated_at,
  };
}

export function formatFeatureFlag(f: WorkOSFeatureFlag): Record<string, unknown> {
  return {
    object: 'feature_flag',
    id: f.id,
    slug: f.slug,
    name: f.name,
    description: f.description,
    type: f.type,
    default_value: f.default_value,
    enabled: f.enabled,
    created_at: f.created_at,
    updated_at: f.updated_at,
  };
}

export function formatConnectApplication(a: WorkOSConnectApplication): Record<string, unknown> {
  return {
    object: 'connect_application',
    id: a.id,
    name: a.name,
    redirect_uris: a.redirect_uris,
    client_id: a.client_id,
    logo_url: a.logo_url,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function formatClientSecret(s: WorkOSClientSecret): Record<string, unknown> {
  return {
    object: 'client_secret',
    id: s.id,
    application_id: s.application_id,
    last_four: s.last_four,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

export function formatRadarAttempt(a: WorkOSRadarAttempt): Record<string, unknown> {
  return {
    object: 'radar_attempt',
    id: a.id,
    user_id: a.user_id,
    ip_address: a.ip_address,
    user_agent: a.user_agent,
    verdict: a.verdict,
    signals: a.signals,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

export function formatApiKeyRecord(k: WorkOSApiKey): Record<string, unknown> {
  return {
    object: 'api_key',
    id: k.id,
    name: k.name,
    created_at: k.created_at,
    updated_at: k.updated_at,
  };
}

export function formatEvent(e: WorkOSEvent): Record<string, unknown> {
  return {
    object: 'event',
    id: e.id,
    event: e.event,
    data: e.data,
    environment_id: e.environment_id,
    created_at: e.created_at,
  };
}

export function formatWebhookEndpoint(
  ep: WorkOSWebhookEndpoint,
  opts?: { includeSecret?: boolean },
): Record<string, unknown> {
  return {
    object: 'webhook_endpoint',
    id: ep.id,
    url: ep.url,
    secret: opts?.includeSecret ? ep.secret : `${ep.secret.slice(0, 8)}****`,
    enabled: ep.enabled,
    events: ep.events,
    description: ep.description,
    created_at: ep.created_at,
    updated_at: ep.updated_at,
  };
}

export function sealSession(
  data: { access_token: string; refresh_token: string; session_id: string },
  apiKey: string,
): string {
  const key = createHash('sha256').update(apiKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}
