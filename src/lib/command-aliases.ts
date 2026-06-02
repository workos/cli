/**
 * Shared canonical command alias map.
 * Single source of truth for both telemetry and help-json.
 *
 * Keys are user-facing aliases, values are canonical command names.
 * Adding an alias here updates both metrics aggregation and --help --json output.
 */
export const COMMAND_ALIASES: Record<string, string> = {
  org: 'organization',
  claim: 'env.claim',
};
