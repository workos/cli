/**
 * Output fields the API-key path returns as `null` because the WorkOS REST API
 * has no source for them, keyed `command.field` (the curated `--json` key).
 * Keys, casing and shapes match the dashboard path; only these values differ.
 *
 * Shared by the offline parity spec (`src/commands/api-key-parity.spec.ts`)
 * and the live comparison in `scripts/parity-smoke.ts --api-key`. Every entry
 * is a missing REST field, never a casing difference: enum casing is
 * normalized on both paths, so a casing-only divergence is a bug.
 */
export const API_KEY_NULL_FIELDS: Record<string, string> = {
  'organization.usersCount': 'REST organizations carry no member count.',
  'user.sessionCount': 'REST users carry no session count.',
  'user.hasPassword': 'REST users do not say whether a password is set.',
  'user.emailVerifiedAt': 'REST users have an email_verified boolean but no verification timestamp.',
  'user.authenticationFactors':
    'REST auth factors carry no last-verified time, so each factor has lastVerifiedAt: null.',
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
  'session.impersonator': 'REST names an impersonator by email only; id, firstName and lastName are null.',
  'config.applicationId': 'REST sets the AuthKit homepage URL without exposing the application ID.',
};
