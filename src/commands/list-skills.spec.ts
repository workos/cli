import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { AgentConfig } from './install-skill.js';

describe('runListSkills', () => {
  let testDir: string;
  let homeDir: string;
  let skillsDir: string;
  let agentSkillsDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'list-skills-test-'));
    homeDir = join(testDir, 'home');
    skillsDir = join(testDir, 'skills');
    agentSkillsDir = join(homeDir, '.test/skills');
    mkdirSync(homeDir);
    mkdirSync(skillsDir);
  });

  afterEach(() => {
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
    const { runListSkills } = await import('./list-skills.js');
    return { runListSkills };
  }

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
    const output = await import('../utils/output.js');
    output.setOutputMode('json');
    const { runListSkills } = await import('./list-skills.js');
    return { runListSkills, resetMode: () => output.setOutputMode('human') };
  }

  it('lists available and installed skills', async () => {
    mkdirSync(join(skillsDir, 'skill-a'), { recursive: true });
    writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# A');
    mkdirSync(join(skillsDir, 'skill-b'), { recursive: true });
    writeFileSync(join(skillsDir, 'skill-b', 'SKILL.md'), '# B');

    mkdirSync(join(agentSkillsDir, 'skill-a'), { recursive: true });
    writeFileSync(join(agentSkillsDir, 'skill-a', 'SKILL.md'), '# A');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runListSkills } = await importMocked();
    await runListSkills({});

    const output = consoleSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(output).toContain('skill-a');
    expect(output).toContain('skill-b');
    consoleSpy.mockRestore();
  });

  it('outputs structured JSON in JSON mode', async () => {
    mkdirSync(join(skillsDir, 'skill-a'), { recursive: true });
    writeFileSync(join(skillsDir, 'skill-a', 'SKILL.md'), '# A');

    mkdirSync(join(agentSkillsDir, 'skill-a'), { recursive: true });
    writeFileSync(join(agentSkillsDir, 'skill-a', 'SKILL.md'), '# A');

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { runListSkills, resetMode } = await importMockedWithJsonMode();
    await runListSkills({});

    const jsonOutput = consoleSpy.mock.calls.find((call) => {
      try {
        JSON.parse(call[0] as string);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonOutput).toBeDefined();
    const parsed = JSON.parse(jsonOutput![0] as string);
    expect(parsed).toEqual([{ agent: 'Test', available: ['skill-a'], installed: ['skill-a'] }]);

    consoleSpy.mockRestore();
    resetMode();
  });
});
