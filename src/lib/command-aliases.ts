/**
 * Shared canonical command alias map.
 * Single source of truth for both telemetry and help-json.
 *
 * Keys are user-facing aliases, values are canonical command names.
 * Adding an alias here updates both metrics aggregation and --help --json output.
 */
export const COMMAND_ALIASES: Record<string, string> = {
  org: 'organization',
  // `env` was the pre-0.22 name for local profiles; kept as a quiet alias.
  env: 'profile',
  claim: 'profile.claim',
};
