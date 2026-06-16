import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { ENV_VAR_CATALOG } from './debug.js';

// Resolve the src/ root from this file's location (src/commands/*.spec.ts).
const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

// Matches dot-access env reads: `process.env.WORKOS_X` and the destructured
// `env.WORKOS_X` form (e.g. interaction-mode.ts), while the lookbehind excludes
// identifiers like `projectEnv.WORKOS_X` / `sdkEnv.WORKOS_X`.
//
// Coverage is limited to dot access — it does NOT catch bracket access
// (`process.env['WORKOS_X']`) or destructuring (`const { WORKOS_X } = process.env`).
// No such reads exist today; if one is introduced, list it in CATALOG_ONLY below
// so the bidirectional check still passes.
const ENV_READ_PATTERN = /(?:process\.env|(?<![\w$])env)\.(WORKOS_[A-Z0-9_]+)/g;

// WORKOS_ vars that belong in the catalog but the scan can't see (non-dot-access
// reads). Empty today — kept as the explicit escape hatch for the limitation above.
const CATALOG_ONLY = new Set<string>();

async function discoverEnvReads(): Promise<Set<string>> {
  const files = await fg('**/*.ts', {
    cwd: SRC_DIR,
    absolute: true,
    ignore: ['**/*.spec.ts', '**/*.d.ts'],
  });
  const contents = await Promise.all(files.map((file) => readFile(file, 'utf-8')));
  const reads = new Set<string>();
  for (const text of contents) {
    for (const match of text.matchAll(ENV_READ_PATTERN)) reads.add(match[1]);
  }
  return reads;
}

describe('WORKOS_ env var catalog (debug env)', () => {
  it('stays in sync with the WORKOS_ env vars the CLI reads (no missing or stale entries)', async () => {
    const discovered = await discoverEnvReads();
    const cataloged = new Set(ENV_VAR_CATALOG.map((v) => v.name));

    const missing = [...discovered].filter((name) => !cataloged.has(name)).sort();
    const stale = [...cataloged].filter((name) => !discovered.has(name) && !CATALOG_ONLY.has(name)).sort();

    expect(missing, `Read in src/ but missing from ENV_VAR_CATALOG (debug.ts): ${missing.join(', ')}`).toEqual([]);
    expect(
      stale,
      `In ENV_VAR_CATALOG (debug.ts) but no longer read in src/ — remove it, or add to CATALOG_ONLY if intentional: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('has no duplicate entries', () => {
    const names = ENV_VAR_CATALOG.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
