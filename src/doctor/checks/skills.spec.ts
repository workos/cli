import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SKILL_VERSION_MARKER_FILENAME } from '../../commands/install-skill.js';

// Mock getBundledSkillsVersion so we don't depend on the real bundled package.
vi.mock('../../commands/install-skill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../commands/install-skill.js')>();
  return {
    ...actual,
    getBundledSkillsVersion: vi.fn(),
  };
});

const { getBundledSkillsVersion } = await import('../../commands/install-skill.js');
const { checkSkills } = await import('./skills.js');

describe('checkSkills', () => {
  let testHome: string;

  beforeEach(() => {
    testHome = mkdtempSync(join(tmpdir(), 'skills-check-'));
    vi.mocked(getBundledSkillsVersion).mockReturnValue('0.3.0');
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns null when no agent skills directories exist', () => {
    expect(checkSkills(testHome)).toBeNull();
  });

  it('returns null when an agent skills dir exists but has no WorkOS skills (no marker, no workos/)', () => {
    // The agent has its skills/ dir for unrelated user-installed skills. We
    // must NOT report it as having WorkOS skills — `doctor --fix` would
    // otherwise write workos/ + workos-widgets/ onto an agent that never
    // opted in. Marker OR workos/ subdir is the signal.
    mkdirSync(join(testHome, '.claude/skills/some-other-skill'), { recursive: true });
    writeFileSync(join(testHome, '.claude/skills/some-other-skill/SKILL.md'), '# Other');

    expect(checkSkills(testHome)).toBeNull();
  });

  it('reports an agent with workos/ subdir but no marker as installedVersion=null and not stale', () => {
    // Pre-Phase-2 install (only SKILL.md was copied) — a real possible state.
    mkdirSync(join(testHome, '.claude/skills/workos'), { recursive: true });

    const result = checkSkills(testHome);

    expect(result).not.toBeNull();
    expect(result!.bundledVersion).toBe('0.3.0');
    expect(result!.agents).toEqual([{ agent: 'Claude Code', installedVersion: null, stale: false }]);
  });

  it('flags an agent as stale when the marker trails the bundled version', () => {
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.2.4');

    const result = checkSkills(testHome);

    expect(result!.agents).toEqual([{ agent: 'Claude Code', installedVersion: '0.2.4', stale: true }]);
  });

  it('does not flag stale when marker matches bundled', () => {
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.3.0');

    const result = checkSkills(testHome);

    expect(result!.agents[0].stale).toBe(false);
  });

  it('never flags stale when bundledVersion is null (unknown)', () => {
    vi.mocked(getBundledSkillsVersion).mockReturnValue(null);
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.2.4');

    const result = checkSkills(testHome);

    expect(result!.bundledVersion).toBeNull();
    expect(result!.agents[0].stale).toBe(false);
  });

  it('reports each detected agent separately', () => {
    mkdirSync(join(testHome, '.claude/skills'), { recursive: true });
    writeFileSync(join(testHome, '.claude/skills', SKILL_VERSION_MARKER_FILENAME), '0.2.4');
    mkdirSync(join(testHome, '.codex/skills'), { recursive: true });
    writeFileSync(join(testHome, '.codex/skills', SKILL_VERSION_MARKER_FILENAME), '0.3.0');

    const result = checkSkills(testHome);

    expect(result!.agents).toHaveLength(2);
    const claude = result!.agents.find((a) => a.agent === 'Claude Code')!;
    const codex = result!.agents.find((a) => a.agent === 'Codex')!;
    expect(claude.stale).toBe(true);
    expect(codex.stale).toBe(false);
  });
});
