import { describe, it, expect } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ENV_VAR_CATALOG } from './debug.js';

// Resolve the src/ root from this file's location (src/commands/*.spec.ts).
const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

// Matches dot-access env reads: `process.env.WORKOS_X` and the destructured
// `env.WORKOS_X` form (e.g. interaction-mode.ts), while the lookbehind excludes
// identifiers like `projectEnv.WORKOS_X` / `sdkEnv.WORKOS_X`.
//
// Coverage is intentionally limited to dot access — it does NOT catch bracket
// access (`process.env['WORKOS_X']`) or object destructuring
// (`const { WORKOS_X } = process.env`). Those forms aren't used today; if one is
// introduced, add the var to the catalog manually. This guard exists to catch
// the common case, not to be exhaustive.
const ENV_READ_PATTERN = /(?:process\.env|(?<![\w$])env)\.(WORKOS_[A-Z0-9_]+)/g;

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) return collectTsFiles(fullPath);
      if (!entry.name.endsWith('.ts')) return [];
      if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.d.ts')) return [];
      return [fullPath];
    }),
  );
  return files.flat();
}

describe('WORKOS_ env var catalog (debug env)', () => {
  it('documents every WORKOS_-prefixed env var read via dot access', async () => {
    const files = await collectTsFiles(SRC_DIR);
    const discovered = new Set<string>();

    for (const file of files) {
      const contents = await readFile(file, 'utf-8');
      for (const match of contents.matchAll(ENV_READ_PATTERN)) {
        discovered.add(match[1]);
      }
    }

    const cataloged = new Set(ENV_VAR_CATALOG.map((v) => v.name));
    const missing = [...discovered].filter((name) => !cataloged.has(name)).sort();

    expect(
      missing,
      `These WORKOS_ env vars are read in src/ but missing from ENV_VAR_CATALOG in debug.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('has no duplicate or stale entries', () => {
    const names = ENV_VAR_CATALOG.map((v) => v.name);
    expect(new Set(names).size).toBe(names.length);
    // Every cataloged var must use the WORKOS_ prefix (no INSTALLER_* drift).
    expect(names.every((n) => n.startsWith('WORKOS_'))).toBe(true);
  });
});
