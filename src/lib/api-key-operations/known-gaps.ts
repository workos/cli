/**
 * Output fields the API-key path returns as `null` because the WorkOS REST API
 * has no source for them. Keys are `command.path`, where `path` points at one
 * leaf of the curated `--json` entity (`[]` steps into every array element).
 * Keys, casing and shapes match the dashboard path; only these values differ.
 *
 * Shared by the offline parity spec (`src/commands/api-key-parity.spec.ts`)
 * and the live comparison in `scripts/parity-smoke.ts --api-key`, which both
 * judge parity with {@link apiKeyParityDiffs}. Every entry is a missing REST
 * field, never a casing difference: enum casing is normalized on both paths,
 * so a casing-only divergence is a bug.
 */
export const API_KEY_NULL_FIELDS: Record<string, string> = {
  'organization.usersCount': 'REST organizations carry no member count.',
  'user.sessionCount': 'REST users carry no session count.',
  'user.hasPassword': 'REST users do not say whether a password is set.',
  'user.emailVerifiedAt': 'REST users have an email_verified boolean but no verification timestamp.',
  'user.authenticationFactors[].lastVerifiedAt': 'REST auth factors carry no last-verified time.',
  'membership.type': 'REST memberships carry no membership type.',
  'event.updatedAt': 'REST events carry only a creation time.',
  'feature-flag.accessType': 'The REST flag endpoints expose no access type.',
  'feature-flag.organizationTargets': 'The REST flag endpoints cannot list a flag’s targets.',
  'feature-flag.userTargets': 'The REST flag endpoints cannot list a flag’s targets.',
  'org-domain.verificationContent':
    'REST returns verification_prefix and verification_token separately, not the combined record.',
  'org-domain.domainCaptureEnabled': 'REST domains carry no domain-capture flag.',
  'portal.id': 'REST generate_link returns only the link URL.',
  'portal.state': 'REST generate_link returns only the link URL.',
  'portal.expiresAt': 'REST generate_link returns only the link URL.',
  'session.provider': 'REST reports OAuth sign-ins as plain "oauth", without naming the OAuth provider.',
  'session.impersonator.id': 'REST names an impersonator by email only.',
  'session.impersonator.firstName': 'REST names an impersonator by email only.',
  'session.impersonator.lastName': 'REST names an impersonator by email only.',
  'config.applicationId': 'REST sets the AuthKit homepage URL without exposing the application ID.',
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Order-insensitive array pairing: by `id` when every element has one, else by JSON. */
function sortForPairing(items: unknown[]): unknown[] {
  const byId = items.every((item) => isPlainObject(item) && typeof item.id === 'string');
  const key = (item: unknown) => (byId ? String((item as { id: string }).id) : JSON.stringify(item));
  return [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

/**
 * Compare one entity from the dashboard path (`session`) with the same entity
 * from the API-key path (`apiKey`). Returns one message per divergence; `[]`
 * means parity.
 *
 * Strict by design: every object must have the same keys on both sides,
 * arrays the same length, and every leaf the same value. The only exception
 * is a leaf listed in {@link API_KEY_NULL_FIELDS} for `command`, which may be
 * `null` on the API-key side whatever the dashboard returned (a non-null value
 * there must still match). A whole object going null, an element losing its
 * keys, or an ID or email disappearing all fail. `ignoreKeys` drops keys at
 * any depth (pagination cursors are opaque and plane-specific).
 */
export function apiKeyParityDiffs(
  command: string,
  session: unknown,
  apiKey: unknown,
  ignoreKeys: ReadonlySet<string> = new Set(),
): string[] {
  const diffs: string[] = [];

  function walk(path: string, s: unknown, k: unknown): void {
    const label = path || '(entity)';
    // A documented gap may be null on the API-key side; any other value there
    // must still match the dashboard exactly.
    if (path && k === null && `${command}.${path}` in API_KEY_NULL_FIELDS) return;
    if (Array.isArray(s) && Array.isArray(k)) {
      if (s.length !== k.length) {
        diffs.push(`${label}: ${s.length} item(s) on the session side, ${k.length} on the API-key side`);
        return;
      }
      // A top-level array is a list of entities; their fields keep bare paths.
      const elementPath = path ? `${path}[]` : '';
      const sorted = [sortForPairing(s), sortForPairing(k)];
      sorted[0].forEach((item, index) => walk(elementPath, item, sorted[1][index]));
      return;
    }
    if (isPlainObject(s) && isPlainObject(k)) {
      const keys = new Set([...Object.keys(s), ...Object.keys(k)]);
      for (const key of keys) {
        if (ignoreKeys.has(key)) continue;
        const child = path ? `${path}.${key}` : key;
        if (!(key in s) || !(key in k)) {
          diffs.push(`${child}: present only on the ${key in s ? 'session' : 'API-key'} side`);
          continue;
        }
        walk(child, s[key], k[key]);
      }
      return;
    }
    if (JSON.stringify(s) !== JSON.stringify(k)) {
      diffs.push(`${label}: session=${JSON.stringify(s)} apiKey=${JSON.stringify(k)}`);
    }
  }

  walk('', session, apiKey);
  return diffs;
}
