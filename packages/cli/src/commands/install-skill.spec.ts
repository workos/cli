import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import {
  createAgents,
  discoverSkills,
  detectAgents,
  installSkill,
  type AgentConfig,
} from './install-skill.js';

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
      writeFileSync(
        join(skillsDir, 'test-skill', 'SKILL.md'),
        '---\nname: test-skill\n---\n# Test Skill',
      );

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

      writeFileSync(
        join(skillsDir, 'test-skill', 'SKILL.md'),
        '---\nname: test-skill\n---\n# Updated Skill',
      );

      const result = await installSkill(skillsDir, 'test-skill', targetAgent);

      expect(result.success).toBe(true);

      const content = readFileSync(
        join(homeDir, '.test-agent/skills/test-skill/SKILL.md'),
        'utf-8',
      );
      expect(content).toContain('# Updated Skill');
    });
  });
});
