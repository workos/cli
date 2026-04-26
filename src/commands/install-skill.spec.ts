import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync, readdirSync, chmodSync } from 'fs';
import { utimes } from 'fs/promises';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import {
  createAgents,
  discoverSkills,
  detectAgents,
  installSkill,
  autoInstallSkills,
  refreshWorkOSSkills,
  type AgentConfig,
} from './install-skill.js';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: vi.fn(actual.homedir) };
});

vi.mock('@workos/skills', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@workos/skills')>();
  return { ...actual, getSkillsDir: vi.fn(actual.getSkillsDir) };
});

// Wrap fs/promises so individual fns (rename, cp) can be temporarily overridden
// via mockImplementationOnce. ESM exports are not directly spy-able, so we
// explicitly recreate the namespace with vi.fn passthroughs for the spies we
// need; everything else stays as the real impl.
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    cp: vi.fn(actual.cp),
  };
});

describe('install-skill', () => {
  let testDir: string;
  let skillsDir: string;
  let homeDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'install-skill-test-'));
    skillsDir = join(testDir, 'skills');
    homeDir = join(testDir, 'home');

    mkdirSync(skillsDir);
    mkdirSync(homeDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('createAgents', () => {
    it('creates agent configs with correct paths', () => {
      const agents = createAgents(homeDir);

      expect(agents['claude-code'].globalSkillsDir).toBe(join(homeDir, '.claude/skills'));
      expect(agents['codex'].globalSkillsDir).toBe(join(homeDir, '.codex/skills'));
      expect(agents['cursor'].globalSkillsDir).toBe(join(homeDir, '.cursor/skills'));
      expect(agents['goose'].globalSkillsDir).toBe(join(homeDir, '.config/goose/skills'));
    });

    it('detect returns true when agent directory exists', () => {
      mkdirSync(join(homeDir, '.claude'));
      const agents = createAgents(homeDir);

      expect(agents['claude-code'].detect()).toBe(true);
      expect(agents['codex'].detect()).toBe(false);
    });

    it('detect returns false when agent directory does not exist', () => {
      const agents = createAgents(homeDir);

      expect(agents['claude-code'].detect()).toBe(false);
      expect(agents['codex'].detect()).toBe(false);
    });
  });

  describe('discoverSkills', () => {
    it('returns empty array when no skills exist', async () => {
      const skills = await discoverSkills(skillsDir);
      expect(skills).toEqual([]);
    });

    it('finds skills with SKILL.md files', async () => {
      mkdirSync(join(skillsDir, 'skill-one'));
      writeFileSync(join(skillsDir, 'skill-one', 'SKILL.md'), '# Skill One');

      mkdirSync(join(skillsDir, 'skill-two'));
      writeFileSync(join(skillsDir, 'skill-two', 'SKILL.md'), '# Skill Two');

      const skills = await discoverSkills(skillsDir);

      expect(skills).toContain('skill-one');
      expect(skills).toContain('skill-two');
      expect(skills).toHaveLength(2);
    });

    it('ignores directories without SKILL.md', async () => {
      mkdirSync(join(skillsDir, 'has-skill'));
      writeFileSync(join(skillsDir, 'has-skill', 'SKILL.md'), '# Skill');

      mkdirSync(join(skillsDir, 'no-skill'));
      writeFileSync(join(skillsDir, 'no-skill', 'README.md'), '# Not a skill');

      const skills = await discoverSkills(skillsDir);

      expect(skills).toContain('has-skill');
      expect(skills).not.toContain('no-skill');
      expect(skills).toHaveLength(1);
    });

    it('ignores files (not directories)', async () => {
      writeFileSync(join(skillsDir, 'not-a-dir.md'), '# File');

      mkdirSync(join(skillsDir, 'real-skill'));
      writeFileSync(join(skillsDir, 'real-skill', 'SKILL.md'), '# Skill');

      const skills = await discoverSkills(skillsDir);

      expect(skills).toEqual(['real-skill']);
    });
  });

  describe('detectAgents', () => {
    it('returns empty array when no agents detected', () => {
      const agents = createAgents(homeDir);
      const detected = detectAgents(agents);

      expect(detected).toEqual([]);
    });

    it('returns detected agents', () => {
      mkdirSync(join(homeDir, '.claude'));
      mkdirSync(join(homeDir, '.cursor'));

      const agents = createAgents(homeDir);
      const detected = detectAgents(agents);

      expect(detected).toHaveLength(2);
      expect(detected.map((a) => a.name)).toContain('claude-code');
      expect(detected.map((a) => a.name)).toContain('cursor');
    });

    it('filters by provided agent names', () => {
      mkdirSync(join(homeDir, '.claude'));
      mkdirSync(join(homeDir, '.cursor'));
      mkdirSync(join(homeDir, '.codex'));

      const agents = createAgents(homeDir);
      const detected = detectAgents(agents, ['claude-code', 'codex']);

      expect(detected).toHaveLength(2);
      expect(detected.map((a) => a.name)).toContain('claude-code');
      expect(detected.map((a) => a.name)).toContain('codex');
      expect(detected.map((a) => a.name)).not.toContain('cursor');
    });

    it('only returns agents that are both filtered and detected', () => {
      mkdirSync(join(homeDir, '.claude'));

      const agents = createAgents(homeDir);
      const detected = detectAgents(agents, ['claude-code', 'codex']);

      expect(detected).toHaveLength(1);
      expect(detected[0].name).toBe('claude-code');
    });
  });

  describe('installSkill', () => {
    let targetAgent: AgentConfig;

    beforeEach(() => {
      mkdirSync(join(skillsDir, 'test-skill'));
      writeFileSync(join(skillsDir, 'test-skill', 'SKILL.md'), '---\nname: test-skill\n---\n# Test Skill');

      // Sub-tree the install must copy alongside SKILL.md.
      mkdirSync(join(skillsDir, 'test-skill', 'references'));
      writeFileSync(join(skillsDir, 'test-skill', 'references', 'topic.md'), '# Topic');

      targetAgent = {
        name: 'test-agent',
        displayName: 'Test Agent',
        globalSkillsDir: join(homeDir, '.test-agent/skills'),
        detect: () => true,
      };
    });

    it('copies SKILL.md to target directory', async () => {
      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const targetFile = join(homeDir, '.test-agent/skills/test-skill/SKILL.md');
      expect(existsSync(targetFile)).toBe(true);

      const content = readFileSync(targetFile, 'utf-8');
      expect(content).toContain('# Test Skill');
    });

    it('copies the entire skill directory tree, including references/', async () => {
      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(true);

      const referenceFile = join(homeDir, '.test-agent/skills/test-skill/references/topic.md');
      expect(existsSync(referenceFile)).toBe(true);
      expect(readFileSync(referenceFile, 'utf-8')).toContain('# Topic');
    });

    it('creates nested directories as needed', async () => {
      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(true);
      expect(existsSync(join(homeDir, '.test-agent/skills/test-skill'))).toBe(true);
    });

    it('returns error when source skill does not exist', async () => {
      const result = await installSkill(skillsDir, 'nonexistent-skill', targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('overwrites existing skill file', async () => {
      await installSkill(skillsDir, 'test-skill', targetAgent);

      writeFileSync(join(skillsDir, 'test-skill', 'SKILL.md'), '---\nname: test-skill\n---\n# Updated Skill');

      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(true);

      const content = readFileSync(join(homeDir, '.test-agent/skills/test-skill/SKILL.md'), 'utf-8');
      expect(content).toContain('# Updated Skill');
    });

    it('prunes stale files in the target that are not in the source (replace, not overlay)', async () => {
      // First install: target now matches source.
      await installSkill(skillsDir, 'test-skill', targetAgent);

      // Plant a stale file the agent had from a prior skill version.
      const staleFile = join(homeDir, '.test-agent/skills/test-skill/references/workos-stale.md');
      writeFileSync(staleFile, '# Stale Topic');
      expect(existsSync(staleFile)).toBe(true);

      // Re-install — the new tree should fully replace the old one.
      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(true);
      expect(existsSync(staleFile)).toBe(false);
      // Source files still present.
      expect(existsSync(join(homeDir, '.test-agent/skills/test-skill/references/topic.md'))).toBe(true);
    });

    it('rolls back to the original target when the temp→target rename fails mid-install', async () => {
      // Seed an existing target so the backup-rename branch has something to back up.
      await installSkill(skillsDir, 'test-skill', targetAgent);
      const targetFile = join(homeDir, '.test-agent/skills/test-skill/SKILL.md');
      const originalContent = readFileSync(targetFile, 'utf-8');

      const fsPromises = await import('fs/promises');
      const realRename = (await vi.importActual<typeof import('fs/promises')>('fs/promises')).rename;

      // Call sequence inside installSkill: 1=target→backup, 2=temp→target (force-throw),
      // 3=backup→target (rollback). After the Once chain consumes calls 1 and 2,
      // the default vi.fn(actual.rename) impl handles call 3 with the real fs op.
      vi.mocked(fsPromises.rename)
        .mockImplementationOnce(realRename)
        .mockImplementationOnce(async () => {
          throw new Error('simulated rename failure');
        });

      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('simulated rename failure');
      // Original target restored from backup.
      expect(existsSync(targetFile)).toBe(true);
      expect(readFileSync(targetFile, 'utf-8')).toBe(originalContent);
    });

    it('cleans up the temp dir when the copy itself fails', async () => {
      const fsPromises = await import('fs/promises');
      vi.mocked(fsPromises.cp).mockRejectedValueOnce(new Error('copy boom'));

      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(false);
      expect(result.error).toContain('copy boom');

      // No leftover .workos.tmp-test-skill-* in the parent.
      const parent = join(homeDir, '.test-agent/skills');
      if (existsSync(parent)) {
        const leftovers = readdirSync(parent).filter((e) => e.startsWith('.workos.tmp-'));
        expect(leftovers).toEqual([]);
      }
    });

    it('removes orphaned .workos.tmp-* / .workos.bak-* siblings older than 1h', async () => {
      const parent = join(homeDir, '.test-agent/skills');
      mkdirSync(parent, { recursive: true });

      // mtime cutoff applies independently to BOTH prefixes, both directions.
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2h ago

      const oldTmp = join(parent, '.workos.tmp-test-skill-deadbeef');
      mkdirSync(oldTmp);
      await utimes(oldTmp, oldTime, oldTime);

      const oldBak = join(parent, '.workos.bak-test-skill-feedface');
      mkdirSync(oldBak);
      await utimes(oldBak, oldTime, oldTime);

      // Fresh siblings simulate a concurrent run — must NOT be deleted.
      const freshTmp = join(parent, '.workos.tmp-test-skill-deadc0de');
      mkdirSync(freshTmp);

      const freshBak = join(parent, '.workos.bak-test-skill-cafef00d');
      mkdirSync(freshBak);

      const result = await installSkill(skillsDir, 'test-skill', targetAgent);
      expect(result.success).toBe(true);

      expect(existsSync(oldTmp)).toBe(false);
      expect(existsSync(oldBak)).toBe(false);
      expect(existsSync(freshTmp)).toBe(true);
      expect(existsSync(freshBak)).toBe(true);
    });

    it('does not remove unrelated files in the parent', async () => {
      const parent = join(homeDir, '.test-agent/skills');
      mkdirSync(parent, { recursive: true });

      // A peer skill from a different installer — must be preserved.
      const peerSkill = join(parent, 'unrelated-skill');
      mkdirSync(peerSkill);
      writeFileSync(join(peerSkill, 'SKILL.md'), '# Other');
      const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
      await utimes(peerSkill, oldTime, oldTime);

      const result = await installSkill(skillsDir, 'test-skill', targetAgent);
      expect(result.success).toBe(true);
      expect(existsSync(join(peerSkill, 'SKILL.md'))).toBe(true);
    });
  });

  describe('autoInstallSkills', () => {
    beforeEach(async () => {
      const { homedir } = await import('os');
      const { getSkillsDir } = await import('@workos/skills');
      vi.mocked(homedir).mockReturnValue(homeDir);
      vi.mocked(getSkillsDir).mockReturnValue(skillsDir);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('installs all skills to all detected agents and returns a summary', async () => {
      // Set up skills
      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# Skill A');
      mkdirSync(join(skillsDir, 'skill-b'));
      writeFileSync(join(skillsDir, 'skill-b', 'SKILL.md'), '# Skill B');

      // Set up detected agents
      mkdirSync(join(homeDir, '.claude'));
      mkdirSync(join(homeDir, '.codex'));

      const result = await autoInstallSkills();

      expect(existsSync(join(homeDir, '.claude/skills/skill-a/SKILL.md'))).toBe(true);
      expect(existsSync(join(homeDir, '.claude/skills/skill-b/SKILL.md'))).toBe(true);
      expect(existsSync(join(homeDir, '.codex/skills/skill-a/SKILL.md'))).toBe(true);
      expect(existsSync(join(homeDir, '.codex/skills/skill-b/SKILL.md'))).toBe(true);

      expect(result).not.toBeNull();
      expect(result!.skills.sort()).toEqual(['skill-a', 'skill-b']);
      expect(result!.agents.sort()).toEqual(['Claude Code', 'Codex']);
    });

    it('writes a version marker per agent when the bundled version is resolvable', async () => {
      // Plant a deterministic package layout so getBundledSkillsVersion finds
      // a real version. The function walks up 3 dirnames from skillsDir to
      // locate the package.json, so we mirror that layout here:
      //   <packageRoot>/package.json   ← version source
      //   <packageRoot>/plugins/workos/skills   ← skillsDir
      const { SKILL_VERSION_MARKER_FILENAME } = await import('./install-skill.js');
      const { getSkillsDir } = await import('@workos/skills');

      const packageRoot = join(testDir, 'pkg');
      mkdirSync(packageRoot);
      writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@workos/skills', version: '9.9.9' }));
      const deepSkillsDir = join(packageRoot, 'plugins/workos/skills');
      mkdirSync(deepSkillsDir, { recursive: true });
      mkdirSync(join(deepSkillsDir, 'skill-a'));
      writeFileSync(join(deepSkillsDir, 'skill-a', 'SKILL.md'), '# Skill A');
      vi.mocked(getSkillsDir).mockReturnValue(deepSkillsDir);

      mkdirSync(join(homeDir, '.claude'));

      const result = await autoInstallSkills();

      expect(result).not.toBeNull();
      expect(result!.version).toBe('9.9.9');

      const marker = join(homeDir, '.claude/skills', SKILL_VERSION_MARKER_FILENAME);
      expect(existsSync(marker)).toBe(true);
      expect(readFileSync(marker, 'utf8')).toBe('9.9.9');
    });

    it('returns null when no agents are detected', async () => {
      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# Skill A');

      // No agent directories created — none detected
      await expect(autoInstallSkills()).resolves.toBeNull();
    });

    it('returns null when no skills are discovered', async () => {
      mkdirSync(join(homeDir, '.claude'));

      // No skills in skillsDir
      await expect(autoInstallSkills()).resolves.toBeNull();
    });

    it('swallows errors from discoverSkills and returns null', async () => {
      // Point to a nonexistent skills directory
      const { getSkillsDir } = await import('@workos/skills');
      vi.mocked(getSkillsDir).mockReturnValue('/nonexistent/path');

      await expect(autoInstallSkills()).resolves.toBeNull();
    });

    it('returns null when every installSkill call fails', async () => {
      // installSkill returns { success: false } on copy errors (doesn't throw).
      // When nothing succeeded, callers should get null so they don't advertise
      // a bogus "installed" message.
      mkdirSync(join(skillsDir, 'test-skill'));
      writeFileSync(join(skillsDir, 'test-skill', 'SKILL.md'), '# Test');

      mkdirSync(join(homeDir, '.claude/skills'), { recursive: true });
      // Make the skills parent read-only so mkdtemp inside it fails with EACCES.
      chmodSync(join(homeDir, '.claude/skills'), 0o555);

      try {
        await expect(autoInstallSkills()).resolves.toBeNull();
      } finally {
        // Restore writable so afterEach cleanup can rm.
        chmodSync(join(homeDir, '.claude/skills'), 0o755);
      }
    });

    it('does not produce any console output', async () => {
      const logSpy = vi.spyOn(console, 'log');
      const errorSpy = vi.spyOn(console, 'error');

      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# Skill A');
      mkdirSync(join(homeDir, '.claude'));

      await autoInstallSkills();

      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });

  describe('refreshWorkOSSkills', () => {
    beforeEach(async () => {
      const { homedir } = await import('os');
      const { getSkillsDir } = await import('@workos/skills');
      vi.mocked(homedir).mockReturnValue(homeDir);
      vi.mocked(getSkillsDir).mockReturnValue(skillsDir);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('reports per-agent before/after marker state keyed by agent.name', async () => {
      const { SKILL_VERSION_MARKER_FILENAME } = await import('./install-skill.js');

      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# Skill A');

      // Plant a pre-existing marker for one agent so we have a non-null "before".
      mkdirSync(join(homeDir, '.claude/skills'), { recursive: true });
      writeFileSync(join(homeDir, '.claude/skills', SKILL_VERSION_MARKER_FILENAME), '0.0.1', 'utf8');

      // Codex has no prior marker.
      mkdirSync(join(homeDir, '.codex'));

      const result = await refreshWorkOSSkills();

      expect(result).not.toBeNull();
      expect(result!.perAgentBefore).toMatchObject({
        'claude-code': '0.0.1',
        codex: null,
      });
      // After: in this fixture skillsDir isn't an npm package layout, so
      // getBundledSkillsVersion returns null and no marker is rewritten.
      // Therefore perAgentAfter must equal perAgentBefore for every agent.
      expect(result!.perAgentAfter).toMatchObject({
        'claude-code': '0.0.1',
        codex: null,
      });
    });

    it('skips marker writing when writeMarker is false', async () => {
      const { SKILL_VERSION_MARKER_FILENAME } = await import('./install-skill.js');

      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# Skill A');
      mkdirSync(join(homeDir, '.claude'));

      const result = await refreshWorkOSSkills({ writeMarker: false });

      expect(result).not.toBeNull();
      const marker = join(homeDir, '.claude/skills', SKILL_VERSION_MARKER_FILENAME);
      expect(existsSync(marker)).toBe(false);
    });

    it('filters skills by the skills option', async () => {
      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# A');
      mkdirSync(join(skillsDir, 'skill-b'));
      writeFileSync(join(skillsDir, 'skill-b', 'SKILL.md'), '# B');
      mkdirSync(join(homeDir, '.claude'));

      const result = await refreshWorkOSSkills({ skills: ['skill-a'] });

      expect(result).not.toBeNull();
      expect(result!.skills).toEqual(['skill-a']);
      expect(existsSync(join(homeDir, '.claude/skills/skill-a/SKILL.md'))).toBe(true);
      expect(existsSync(join(homeDir, '.claude/skills/skill-b'))).toBe(false);
    });

    it('uses the agents option instead of detecting from $HOME', async () => {
      mkdirSync(join(skillsDir, 'skill-a'));
      writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# A');

      // No agent dirs in homeDir — detectAgents would return [].
      // Pass an explicit agent so the install proceeds anyway.
      const explicitAgent: AgentConfig = {
        name: 'manual',
        displayName: 'Manual Agent',
        globalSkillsDir: join(homeDir, 'manual/skills'),
        detect: () => true,
      };

      const result = await refreshWorkOSSkills({ agents: [explicitAgent] });

      expect(result).not.toBeNull();
      expect(result!.agents.map((a) => a.name)).toEqual(['manual']);
      expect(existsSync(join(homeDir, 'manual/skills/skill-a/SKILL.md'))).toBe(true);
    });

    it('returns null when no agents and no skills', async () => {
      // Empty skillsDir, no detected agents.
      await expect(refreshWorkOSSkills()).resolves.toBeNull();
    });
  });
});
