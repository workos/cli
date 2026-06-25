import type { CommandJustification } from './manifest-types.js';

/**
 * The curated allowlist of catalog-driven commands.
 *
 * Each entry is a complete {@link CommandJustification} — the two-axis rubric
 * that justifies surfacing a catalog operation as a first-class WorkOS command.
 * Entries are validated by `validateManifest` (justification.ts) and gated in CI
 * via `pnpm justification:check`.
 *
 * Phase 2 ships the machinery with an empty manifest; the first real entries
 * (the first command category) land in Phase 3.
 */
const MANIFEST: CommandJustification[] = [];

/** Returns the curated command allowlist. */
export function getManifest(): CommandJustification[] {
  return MANIFEST;
}
