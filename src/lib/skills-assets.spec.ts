import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BUNDLED_SKILLS_VERSION, getReference, getSkillsDir } from './skills-assets.js';

function extractionSuffix(): string {
  return process.platform === 'win32' ? '' : `-${process.getuid?.() ?? 0}`;
}

/** Recursively collect any leftover atomic-write temp files under a directory. */
function tempFilesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.includes('.tmp.')) found.push(full);
    }
  };
  walk(root);
  return found;
}

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
    const suffix = extractionSuffix();
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

describe('materializeFile concurrent extraction race', () => {
  // The extraction root is version-keyed and shared with the other tests and
  // real CLI runs on this machine; each test wipes it first so materializeFile's
  // identical-target pre-check can't short-circuit before the mocked rename runs.
  const extractionRoot = join(tmpdir(), `workos-skills-${BUNDLED_SKILLS_VERSION}${extractionSuffix()}`);

  it('re-throws the rename failure when a concurrent winner wrote divergent bytes', async () => {
    rmSync(extractionRoot, { recursive: true, force: true });

    let raced = false;
    try {
      vi.resetModules();
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return {
          ...actual,
          renameSync(oldPath: string, newPath: string): void {
            // Simulate a concurrent winner for the first extracted asset only:
            // publish DIVERGENT bytes at the target, then fail this rename.
            if (!raced && newPath.includes('workos-skills-')) {
              raced = true;
              actual.writeFileSync(newPath, Buffer.from('divergent winner contents'));
              throw Object.assign(new Error('EEXIST: file already exists, rename'), { code: 'EEXIST' });
            }
            actual.renameSync(oldPath, newPath);
          },
        };
      });

      const mod = await import('./skills-assets.js');
      expect(() => mod.materializeSkillsDir()).toThrow(/EEXIST/);
      expect(raced).toBe(true);
      // The temp file for the raced asset must be cleaned up before re-throwing.
      expect(tempFilesUnder(extractionRoot)).toEqual([]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  it('accepts a byte-identical file written by a concurrent winner when rename fails', async () => {
    rmSync(extractionRoot, { recursive: true, force: true });

    let raced = false;
    try {
      vi.resetModules();
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return {
          ...actual,
          renameSync(oldPath: string, newPath: string): void {
            // Simulate a concurrent winner for the first extracted asset only:
            // publish a BYTE-IDENTICAL copy at the target, then fail this rename.
            // Later assets extract normally so materializeSkillsDir can finish.
            if (!raced && newPath.includes('workos-skills-')) {
              raced = true;
              actual.writeFileSync(newPath, actual.readFileSync(oldPath));
              throw Object.assign(new Error('EEXIST: file already exists, rename'), { code: 'EEXIST' });
            }
            actual.renameSync(oldPath, newPath);
          },
        };
      });

      const mod = await import('./skills-assets.js');
      const skillsDir = mod.materializeSkillsDir();

      expect(raced).toBe(true);
      // Recovery accepted the winner's copy and the rest of the tree extracted.
      expect(existsSync(join(skillsDir, 'workos', 'SKILL.md'))).toBe(true);
      expect(existsSync(join(skillsDir, 'workos-widgets', 'SKILL.md'))).toBe(true);
      // The temp file for the raced asset must be removed, not orphaned.
      expect(tempFilesUnder(extractionRoot)).toEqual([]);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });
});
