import { randomBytes, createHash } from 'node:crypto';
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

export function parseListParams(url: URL) {
  const limit = Math.max(1, Math.min(parseInt(url.searchParams.get('limit') ?? '10'), 100));
  const order = (url.searchParams.get('order') as 'asc' | 'desc') ?? 'desc';
  const before = url.searchParams.get('before') ?? undefined;
  const after = url.searchParams.get('after') ?? undefined;
  return { limit, order, before, after };
}
