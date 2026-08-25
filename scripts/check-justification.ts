#!/usr/bin/env tsx
/**
 * CI gate for the command justification manifest.
 *
 * Loads the curated manifest and the vendored Management catalog, runs
 * `validateManifest`, and exits non-zero if any entry is incomplete or maps to
 * an operation the catalog does not contain. Wired to `pnpm justification:check`
 * and run in CI so an unjustified or drifted command cannot ship.
 *
 * Usage:
 *   pnpm justification:check
 */

import { getManifest } from '../src/catalog/manifest.js';
import { loadManagementCatalog } from '../src/catalog/loader.js';
import { validateManifest } from '../src/catalog/justification.js';

function main(): void {
  const manifest = getManifest();
  // Validate against the full catalog (including feature-flag-gated ops): a
  // manifest entry may legitimately target a flagged operation, and we only
  // want to fail on genuinely-unknown `mapsTo` values, not on visibility.
  const catalog = loadManagementCatalog(undefined, { includeFeatureFlagged: true });

  const { ok, errors } = validateManifest(manifest, catalog);

  if (ok) {
    console.log(`justification:check — OK (${manifest.length} command(s) validated)`);
    process.exit(0);
  }

  console.error(`justification:check — FAILED (${errors.length} error(s)):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

main();
