import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { integrationLoaders } from './_manifest.js';

const integrationsDir = dirname(fileURLToPath(import.meta.url));

/** Integration directories on disk, using the same rules as the registry. */
function integrationDirsOnDisk(): string[] {
  return readdirSync(integrationsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .filter((name) => existsSync(join(integrationsDir, name, 'index.ts')));
}

describe('integration manifest', () => {
  // The drift guard: a hand-maintained manifest is only safe if it can't
  // silently fall out of sync with the integration directories. This test
  // fails the moment someone adds an integration and forgets the manifest
  // (or vice versa) — which would otherwise only surface in a shipped binary.
  it('has a loader for every integration directory and no extras', () => {
    const dirs = integrationDirsOnDisk().sort();
    const keys = Object.keys(integrationLoaders).sort();
    expect(keys).toEqual(dirs);
  });

  // Each loader must point at a real module with the IntegrationModule shape.
  // Catches a typo'd import path before it reaches runtime.
  it('each loader resolves to a module exporting config and run', async () => {
    for (const [name, load] of Object.entries(integrationLoaders)) {
      const mod = await load();
      expect(mod.config, `${name}: config export`).toBeDefined();
      expect(typeof mod.run, `${name}: run export`).toBe('function');
      expect(mod.config.metadata.integration, `${name}: metadata.integration`).toBeTruthy();
    }
  });
});
