import { randomBytes, createHash, createCipheriv } from 'node:crypto';
import { WorkOSApiError, type CursorPaginatedResult, type Entity } from '../core/index.js';
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
  WorkOSFlagTarget,
  WorkOSConnectApplication,
  WorkOSClientSecret,
  WorkOSRadarAttempt,
  WorkOSApiKey,
  WorkOSEvent,
  WorkOSWebhookEndpoint,
} from './entities.js';

const INTERNAL_FIELDS = new Set<string>(['password_hash', 'code_challenge', 'code_challenge_method']);

export function formatEntity<T extends Entity>(entity: T, opts?: { exclude?: Set<string> }): Record<string, unknown> {
  const exclude = opts?.exclude ?? INTERNAL_FIELDS;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity)) {
    if (!exclude.has(key)) result[key] = value;
  }
  return result;
}

export function formatListResponse<T>(
  result: CursorPaginatedResult<T>,
  formatter: (item: T) => Record<string, unknown>,
): { object: 'list'; data: Record<string, unknown>[]; list_metadata: { before: string | null; after: string | null } } {
  return {
    object: 'list',
    data: result.data.map(formatter),
    list_metadata: result.list_metadata,
  };
}

export function formatOrganization(
  org: WorkOSOrganization,
  ws: WorkOSStore,
  opts?: { domains?: WorkOSOrganizationDomain[] },
): Record<string, unknown> {
  const domains = (opts?.domains ?? ws.organizationDomains.findBy('organization_id', org.id)).map(formatDomain);

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
  return formatEntity(domain);
}

export function formatMembership(m: WorkOSOrganizationMembership): Record<string, unknown> {
  return formatEntity(m);
}

const USER_EXCLUDE = new Set([...INTERNAL_FIELDS, 'impersonator']);

export function formatUser(user: WorkOSUser): Record<string, unknown> {
  return formatEntity(user, { exclude: USER_EXCLUDE });
}

export function formatSession(s: WorkOSSession): Record<string, unknown> {
  return formatEntity(s);
}

export function formatEmailVerification(ev: WorkOSEmailVerification): Record<string, unknown> {
  return formatEntity(ev);
}

export function formatPasswordReset(pr: WorkOSPasswordReset): Record<string, unknown> {
  return formatEntity(pr);
}

export function formatMagicAuth(ma: WorkOSMagicAuth): Record<string, unknown> {
  return formatEntity(ma);
}

export function formatAuthFactor(f: WorkOSAuthenticationFactor): Record<string, unknown> {
  return formatEntity(f);
}

export function formatIdentity(i: WorkOSIdentity): Record<string, unknown> {
  return formatEntity(i);
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
  return formatEntity(conn);
}

export function formatSSOProfile(p: WorkOSSSOProfile): Record<string, unknown> {
  return formatEntity(p);
}

export function formatPipeConnection(pc: WorkOSPipeConnection): Record<string, unknown> {
  return formatEntity(pc);
}

export function formatInvitation(inv: WorkOSInvitation): Record<string, unknown> {
  return formatEntity(inv);
}

export function formatRedirectUri(r: WorkOSRedirectUri): Record<string, unknown> {
  return formatEntity(r);
}

export function formatCorsOrigin(o: WorkOSCorsOrigin): Record<string, unknown> {
  return formatEntity(o);
}

export function formatAuthorizedApplication(a: WorkOSAuthorizedApplication): Record<string, unknown> {
  return formatEntity(a);
}

export function formatConnectedAccount(a: WorkOSConnectedAccount): Record<string, unknown> {
  return formatEntity(a);
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

const AUTH_CHALLENGE_EXCLUDE = new Set([...INTERNAL_FIELDS, 'code']);

export function formatAuthChallenge(c: WorkOSAuthenticationChallenge): Record<string, unknown> {
  return formatEntity(c, { exclude: AUTH_CHALLENGE_EXCLUDE });
}

export function formatRole(role: WorkOSRole): Record<string, unknown> {
  return formatEntity(role);
}

export function formatPermission(p: WorkOSPermission): Record<string, unknown> {
  return formatEntity(p);
}

export function formatAuthorizationResource(r: WorkOSAuthorizationResource): Record<string, unknown> {
  return formatEntity(r);
}

export function formatRoleAssignment(ra: WorkOSRoleAssignment): Record<string, unknown> {
  return formatEntity(ra);
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

export function formatDirectory(d: WorkOSDirectory): Record<string, unknown> {
  return formatEntity(d);
}

export function formatDirectoryUser(u: WorkOSDirectoryUser): Record<string, unknown> {
  return formatEntity(u);
}

export function formatDirectoryGroup(g: WorkOSDirectoryGroup): Record<string, unknown> {
  return formatEntity(g);
}

export function formatAuditLogAction(a: WorkOSAuditLogAction): Record<string, unknown> {
  return formatEntity(a);
}

export function formatAuditLogEvent(e: WorkOSAuditLogEvent): Record<string, unknown> {
  return formatEntity(e);
}

export function formatAuditLogExport(ex: WorkOSAuditLogExport): Record<string, unknown> {
  return formatEntity(ex);
}

export function formatFeatureFlag(f: WorkOSFeatureFlag): Record<string, unknown> {
  return formatEntity(f);
}

export function formatFlagTarget(t: WorkOSFlagTarget): Record<string, unknown> {
  return formatEntity(t);
}

export function formatConnectApplication(a: WorkOSConnectApplication): Record<string, unknown> {
  return formatEntity(a);
}

const CLIENT_SECRET_EXCLUDE = new Set([...INTERNAL_FIELDS, 'value']);

export function formatClientSecret(s: WorkOSClientSecret): Record<string, unknown> {
  return formatEntity(s, { exclude: CLIENT_SECRET_EXCLUDE });
}

export function formatRadarAttempt(a: WorkOSRadarAttempt): Record<string, unknown> {
  return formatEntity(a);
}

const API_KEY_EXCLUDE = new Set([...INTERNAL_FIELDS, 'key', 'environment']);

export function formatApiKeyRecord(k: WorkOSApiKey): Record<string, unknown> {
  return formatEntity(k, { exclude: API_KEY_EXCLUDE });
}

const EVENT_EXCLUDE = new Set([...INTERNAL_FIELDS, 'updated_at']);

export function formatEvent(e: WorkOSEvent): Record<string, unknown> {
  return formatEntity(e, { exclude: EVENT_EXCLUDE });
}

export function formatWebhookEndpoint(
  ep: WorkOSWebhookEndpoint,
  opts?: { includeSecret?: boolean },
): Record<string, unknown> {
  return {
    object: 'webhook_endpoint',
    id: ep.id,
    endpoint_url: ep.endpoint_url,
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
