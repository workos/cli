import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
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

    it('returns empty array when globalSkillsDir does not exist', () => {
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

describe('runUninstallSkill', () => {
  let testDir: string;
  let homeDir: string;
  let skillsDir: string;
  let agentSkillsDir: string;
  let mockExit: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'uninstall-run-test-'));
    homeDir = join(testDir, 'home');
    skillsDir = join(testDir, 'skills');
    agentSkillsDir = join(homeDir, '.test/skills');
    mkdirSync(homeDir);
    mkdirSync(skillsDir);
    mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    mockExit.mockRestore();
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(testDir, { recursive: true, force: true });
  });

  function makeTestAgent(): AgentConfig {
    return { name: 'test', displayName: 'Test', globalSkillsDir: agentSkillsDir, detect: () => true };
  }

  async function importMocked() {
    vi.resetModules();
    vi.doMock('./install-skill.js', async (importOriginal) => {
      const mod = await importOriginal<typeof import('./install-skill.js')>();
      return {
        ...mod,
        getSkillsDir: () => skillsDir,
        createAgents: () => ({ test: makeTestAgent() }),
        detectAgents: () => [makeTestAgent()],
      };
    });
    const { runUninstallSkill } = await import('./uninstall-skill.js');
    return { runUninstallSkill };
  }

  it('exits with error when --skill contains only unknown names', async () => {
    mkdirSync(join(skillsDir, 'authkit-setup'), { recursive: true });
    writeFileSync(join(skillsDir, 'authkit-setup', 'SKILL.md'), '# AuthKit');

    const { runUninstallSkill } = await importMocked();
    await runUninstallSkill({ skill: ['nonexistent-skill'] });

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('does not uninstall all skills when --skill filter partially matches', async () => {
    // Set up known skills
    for (const name of ['skill-a', 'skill-b']) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, 'SKILL.md'), `# ${name}`);
    }

    // Set up installed skills for the agent
    for (const name of ['skill-a', 'skill-b']) {
      mkdirSync(join(agentSkillsDir, name), { recursive: true });
      writeFileSync(join(agentSkillsDir, name, 'SKILL.md'), `# ${name}`);
    }

    const { runUninstallSkill } = await importMocked();
    await runUninstallSkill({ skill: ['skill-a', 'typo-skill'] });

    // skill-a should be removed, skill-b should be untouched
    expect(existsSync(join(agentSkillsDir, 'skill-a', 'SKILL.md'))).toBe(false);
    expect(existsSync(join(agentSkillsDir, 'skill-b', 'SKILL.md'))).toBe(true);
  });

  describe('JSON mode', () => {
    async function importMockedWithJsonMode() {
      vi.resetModules();
      vi.doMock('./install-skill.js', async (importOriginal) => {
        const mod = await importOriginal<typeof import('./install-skill.js')>();
        return {
          ...mod,
          getSkillsDir: () => skillsDir,
          createAgents: () => ({ test: makeTestAgent() }),
          detectAgents: () => [makeTestAgent()],
        };
      });
      // Import output.js from the fresh module graph and set JSON mode
      const output = await import('../utils/output.js');
      output.setOutputMode('json');
      const { runUninstallSkill } = await import('./uninstall-skill.js');
      return { runUninstallSkill, resetMode: () => output.setOutputMode('human') };
    }

    it('outputs structured JSON results for uninstall', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      // Set up a known skill
      mkdirSync(join(skillsDir, 'test-skill'), { recursive: true });
      writeFileSync(join(skillsDir, 'test-skill', 'SKILL.md'), '# Test');

      // Set up installed skill for the agent
      mkdirSync(join(agentSkillsDir, 'test-skill'), { recursive: true });
      writeFileSync(join(agentSkillsDir, 'test-skill', 'SKILL.md'), '# Test');

      const { runUninstallSkill, resetMode } = await importMockedWithJsonMode();
      await runUninstallSkill({});

      const jsonOutput = consoleSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0] as string);
          return parsed.removed !== undefined;
        } catch {
          return false;
        }
      });
      expect(jsonOutput).toBeDefined();
      const parsed = JSON.parse(jsonOutput![0] as string);
      expect(parsed.removed).toHaveLength(1);
      expect(parsed.removed[0].skill).toBe('test-skill');

      consoleSpy.mockRestore();
      resetMode();
    });

    it('outputs structured JSON error for unknown skills', async () => {
      const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mkdirSync(join(skillsDir, 'authkit-setup'), { recursive: true });
      writeFileSync(join(skillsDir, 'authkit-setup', 'SKILL.md'), '# AuthKit');

      const { runUninstallSkill, resetMode } = await importMockedWithJsonMode();
      await runUninstallSkill({ skill: ['nonexistent'] });

      const jsonError = stderrSpy.mock.calls.find((call) => {
        try {
          const parsed = JSON.parse(call[0] as string);
          return parsed.error?.code === 'SKILL_NOT_FOUND';
        } catch {
          return false;
        }
      });
      expect(jsonError).toBeDefined();

      stderrSpy.mockRestore();
      resetMode();
    });
  });
});
