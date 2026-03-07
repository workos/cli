import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { createAgents, type AgentConfig } from './install-skill.js';
import { findInstalledSkills, uninstallSkill } from './uninstall-skill.js';

describe('uninstall-skill', () => {
  let testDir: string;
  let homeDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'uninstall-skill-test-'));
    homeDir = join(testDir, 'home');
    mkdirSync(homeDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('findInstalledSkills', () => {
    let agent: AgentConfig;

    beforeEach(() => {
      agent = {
        name: 'test-agent',
        displayName: 'Test Agent',
        globalSkillsDir: join(homeDir, '.test-agent/skills'),
        detect: () => true,
      };
    });

    it('returns empty array when no skills are installed', () => {
      mkdirSync(agent.globalSkillsDir, { recursive: true });
      const result = findInstalledSkills(['skill-one', 'skill-two'], agent);
      expect(result).toEqual([]);
    });

    it('returns only skills that exist in agent directory', () => {
      const skillDir = join(agent.globalSkillsDir, 'skill-one');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# Skill One');

      const result = findInstalledSkills(['skill-one', 'skill-two'], agent);
      expect(result).toEqual(['skill-one']);
    });

    it('returns all matching skills when multiple are installed', () => {
      for (const name of ['skill-one', 'skill-two']) {
        const skillDir = join(agent.globalSkillsDir, name);
        mkdirSync(skillDir, { recursive: true });
        writeFileSync(join(skillDir, 'SKILL.md'), `# ${name}`);
      }

      const result = findInstalledSkills(['skill-one', 'skill-two', 'skill-three'], agent);
      expect(result).toEqual(['skill-one', 'skill-two']);
    });

    it('ignores directories without SKILL.md', () => {
      const skillDir = join(agent.globalSkillsDir, 'skill-one');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'README.md'), '# Not a skill');

      const result = findInstalledSkills(['skill-one'], agent);
      expect(result).toEqual([]);
    });

    it('does not detect skills not in the known list', () => {
      const skillDir = join(agent.globalSkillsDir, 'custom-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# Custom');

      const result = findInstalledSkills(['workos-skill'], agent);
      expect(result).toEqual([]);
    });
  });

  describe('uninstallSkill', () => {
    let agent: AgentConfig;

    beforeEach(() => {
      agent = {
        name: 'test-agent',
        displayName: 'Test Agent',
        globalSkillsDir: join(homeDir, '.test-agent/skills'),
        detect: () => true,
      };
    });

    it('removes skill directory', async () => {
      const skillDir = join(agent.globalSkillsDir, 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# Test');

      const result = await uninstallSkill('test-skill', agent);

      expect(result.success).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    });

    it('succeeds when directory does not exist', async () => {
      const result = await uninstallSkill('nonexistent-skill', agent);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('removes directory and all contents', async () => {
      const skillDir = join(agent.globalSkillsDir, 'test-skill');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# Test');
      writeFileSync(join(skillDir, 'extra-file.txt'), 'extra');

      const result = await uninstallSkill('test-skill', agent);

      expect(result.success).toBe(true);
      expect(existsSync(skillDir)).toBe(false);
    });
  });

  describe('createAgents integration', () => {
    it('uses correct skill paths for uninstall detection', () => {
      mkdirSync(join(homeDir, '.claude'), { recursive: true });
      const agents = createAgents(homeDir);
      const claudeAgent = agents['claude-code'];

      const skillDir = join(claudeAgent.globalSkillsDir, 'workos-test');
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(join(skillDir, 'SKILL.md'), '# Test');

      const installed = findInstalledSkills(['workos-test', 'workos-other'], claudeAgent);
      expect(installed).toEqual(['workos-test']);
    });
  });
});
