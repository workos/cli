import { describe, it, expect } from 'vitest';
import { getReference } from '@workos/skills';
import { integrationLoaders } from './_manifest.js';

/**
 * Drift guard: every reference name an integration bakes into its prompt must
 * exist in the bundled @workos/skills package. Without this, a renamed or
 * removed reference only surfaces as a runtime crash during `workos install`
 * (getReference throws while building the agent prompt).
 */
describe('integration reference names resolve in @workos/skills', () => {
  it('workos-authkit-base (prompt-builder baseline) resolves', async () => {
    await expect(getReference('workos-authkit-base')).resolves.toBeTruthy();
  });

  for (const [name, load] of Object.entries(integrationLoaders)) {
    it(`${name}: metadata.skillName resolves`, async () => {
      const mod = await load();
      const skillName = mod.config.metadata.skillName;
      expect(skillName, `${name} is missing metadata.skillName`).toBeTruthy();
      await expect(getReference(skillName as string)).resolves.toBeTruthy();
    });
  }

  it('the guard itself rejects unknown reference names', async () => {
    await expect(getReference('not-a-real-reference')).rejects.toThrow();
  });
});
