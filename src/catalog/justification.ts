import type { ManagementCatalog } from './catalog-types.js';
import type { Audience, CiPolicy, CommandJustification, Load } from './manifest-types.js';

/**
 * The hard gate behind "justify every command".
 *
 * {@link validateManifest} rejects any manifest entry that is incomplete or that
 * maps to an operation the catalog does not contain. It is the manifest-level
 * drift safety net: until the dedicated CI drift gate lands in a later phase, a
 * `mapsTo` pointing at a stale/renamed operation is caught here.
 *
 * The CI entrypoint (`scripts/check-justification.ts`, wired to
 * `pnpm justification:check`) calls this and exits non-zero on any error.
 */

const LOADS: readonly Load[] = ['cheap', 'expensive', 'bulk'];
const CI_POLICIES: readonly CiPolicy[] = ['allow', 'require-flag', 'block-noninteractive'];
const AUDIENCES: readonly Audience[] = ['human', 'agent', 'ci'];

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validates a manifest against the catalog. Returns `{ ok, errors }`; `ok` is
 * true only when `errors` is empty.
 *
 * Per entry, an error is recorded for: an empty/blank `command` or `useCase`;
 * an empty `audiences` (or one containing an invalid audience); a `load` or
 * `ciPolicy` outside its enum; a non-boolean `mutation` or `destructive`; or a
 * `mapsTo` that names no operation in the catalog. Every required field of
 * {@link CommandJustification} is covered by one of these checks — a missing
 * field fails its own field-level check, so there is no separate presence pass.
 */
export function validateManifest(manifest: CommandJustification[], catalog: ManagementCatalog): ValidationResult {
  const errors: string[] = [];
  const opNames = new Set(catalog.operations.map((op) => op.name));

  manifest.forEach((entry, index) => {
    // A stable label for error messages: prefer the command name, fall back to
    // the index so even a malformed entry is identifiable.
    const label = isNonEmptyString(entry?.command) ? `"${entry.command}"` : `#${index}`;

    if (entry == null || typeof entry !== 'object') {
      errors.push(`Entry ${label}: not an object`);
      return;
    }

    if (!isNonEmptyString(entry.command)) {
      errors.push(`Entry ${label}: "command" must be a non-empty string`);
    }

    if (!isNonEmptyString(entry.useCase)) {
      errors.push(`Entry ${label}: "useCase" must be a non-empty string`);
    }

    if (!Array.isArray(entry.audiences) || entry.audiences.length === 0) {
      errors.push(`Entry ${label}: "audiences" must be a non-empty array`);
    } else {
      const invalid = entry.audiences.filter((a) => !AUDIENCES.includes(a));
      if (invalid.length > 0) {
        errors.push(`Entry ${label}: invalid audience(s) [${invalid.join(', ')}] (allowed: ${AUDIENCES.join(', ')})`);
      }
    }

    if (!LOADS.includes(entry.load)) {
      errors.push(`Entry ${label}: "load" must be one of [${LOADS.join(', ')}]`);
    }

    if (!CI_POLICIES.includes(entry.ciPolicy)) {
      errors.push(`Entry ${label}: "ciPolicy" must be one of [${CI_POLICIES.join(', ')}]`);
    }

    if (typeof entry.mutation !== 'boolean') {
      errors.push(`Entry ${label}: "mutation" must be a boolean`);
    }

    if (typeof entry.destructive !== 'boolean') {
      errors.push(`Entry ${label}: "destructive" must be a boolean`);
    }

    if (!isNonEmptyString(entry.mapsTo)) {
      errors.push(`Entry ${label}: "mapsTo" must be a non-empty string`);
    } else if (!opNames.has(entry.mapsTo)) {
      errors.push(`Entry ${label}: "mapsTo" "${entry.mapsTo}" is not an operation in the catalog`);
    }
  });

  return { ok: errors.length === 0, errors };
}
