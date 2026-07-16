import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLED_SKILLS_VERSION, getReference, getSkillsDir } from './skills-assets.js';

describe('embedded skills assets', () => {
  it('materializes the complete plugin tree to a real directory', async () => {
    const skillsDir = getSkillsDir();
    expect(skillsDir).toContain(`workos-skills-${BUNDLED_SKILLS_VERSION}`);
    expect(existsSync(join(skillsDir, 'workos', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsDir, 'workos-widgets', 'SKILL.md'))).toBe(true);

    const reference = await getReference('workos-authkit-base');
    expect(reference).toBe(readFileSync(join(skillsDir, 'workos', 'references', 'workos-authkit-base.md'), 'utf8'));
  });

  it('reaps stale extraction roots from other versions, keeping fresh ones', async () => {
    const suffix = process.platform === 'win32' ? '' : `-${process.getuid?.() ?? 0}`;
    const staleRoot = join(tmpdir(), `workos-skills-0.0.1-spec-stale${suffix}`);
    const freshRoot = join(tmpdir(), `workos-skills-0.0.2-spec-fresh${suffix}`);
    mkdirSync(staleRoot, { recursive: true });
    mkdirSync(freshRoot, { recursive: true });
    // Backdate past the 24h reap cutoff; the fresh root stays (it could
    // belong to a concurrently running CLI of another version).
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    utimesSync(staleRoot, twoDaysAgo, twoDaysAgo);

    try {
      // Fresh module instance: materializeSkillsDir caches per module graph.
      vi.resetModules();
      const fresh = await import('./skills-assets.js');
      fresh.getSkillsDir();

      expect(existsSync(staleRoot)).toBe(false);
      expect(existsSync(freshRoot)).toBe(true);
    } finally {
      rmSync(staleRoot, { recursive: true, force: true });
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });
});
