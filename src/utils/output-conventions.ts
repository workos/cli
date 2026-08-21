/**
 * Output conventions for the CLI's `--json` contract.
 *
 * The `--json` output is a public API: users script against it with jq and in
 * CI. That means the backend's vocabulary is an implementation detail and must
 * never leak through untranslated, or the next backend migration becomes
 * another user-visible break.
 *
 * The rules, applied by every curated shape:
 *
 *   - Keys are camelCase.
 *   - Enum VALUES are lowercase. Backends emit assorted casings (`Verified`,
 *     `PENDING`, `Active`); the CLI emits one convention.
 *   - Enum INPUT is case-insensitive. Whatever the CLI prints for a field it
 *     accepts for that field ("forgiving in, canonical out"), so values
 *     round-trip.
 *   - `metadata` is an object map, not an array of pairs, so `.metadata.foo`
 *     resolves.
 *   - Internal/backend-only fields are dropped.
 *
 * Route every enum and metadata field through the helpers here rather than
 * hand-normalizing per command. Centralizing it is what makes the
 * exhaustiveness test in output-conventions.spec.ts able to catch drift.
 */

/**
 * Normalize a backend enum value to the CLI's lowercase convention.
 *
 * Empty string collapses to null alongside null/undefined: an absent enum and a
 * blank one mean the same thing to a consumer, and `""` in a `state` field is
 * never useful.
 */
export function enumOut(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  return value.toLowerCase();
}

/**
 * Normalize enum input for comparison against the CLI's lowercase vocabulary.
 * Pair with `enumOut` so a value the CLI printed is accepted back verbatim.
 */
export function enumIn(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  return value.toLowerCase();
}

/** The array-of-pairs form GraphQL uses because its schema has no map type. */
export interface MetadataPair {
  key: string;
  value: string;
}

/**
 * Fold metadata into the object map the CLI contract exposes.
 *
 * GraphQL returns `[{key,value}]` purely as a transport encoding. Emitting that
 * shape would silently break every `.metadata.foo` lookup (jq returns empty
 * rather than erroring), so the CLI translates it back. Duplicate keys resolve
 * last-wins; the backend does not produce them, and picking a rule beats
 * throwing on data the user cannot fix.
 */
export function metadataToMap(
  value: MetadataPair[] | Record<string, string> | null | undefined,
): Record<string, string> {
  if (!value) return {};
  if (!Array.isArray(value)) return value;
  const out: Record<string, string> = {};
  for (const pair of value) {
    if (pair && typeof pair.key === 'string' && pair.key !== '') out[pair.key] = pair.value;
  }
  return out;
}
