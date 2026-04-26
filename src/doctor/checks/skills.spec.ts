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
    vi.mocked(getBundledSkillsVersion).mockResolvedValue('0.3.0');
  });

  afterEach(() => {
    rmSync(testHome, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns null when no agent skills directories exist', async () => {
    expect(await checkSkills(testHome)).toBeNull();
  });

  it('returns null when an agent skills dir exists but has no WorkOS skills (no marker, no workos/, no workos-widgets/)', async () => {
    // The agent has its skills/ dir for unrelated user-installed skills. We
    // must NOT report it as having WorkOS skills — `doctor --fix` would
    // otherwise write workos/ + workos-widgets/ onto an agent that never
    // opted in. Marker OR workos/ OR workos-widgets/ subdir is the signal.
    mkdirSync(join(testHome, '.claude/skills/some-other-skill'), { recursive: true });
    writeFileSync(join(testHome, '.claude/skills/some-other-skill/SKILL.md'), '# Other');

    expect(await checkSkills(testHome)).toBeNull();
  });

  it('reports an agent with workos/ subdir but no marker as installedVersion=null and not stale', async () => {
    // Pre-Phase-2 install (only SKILL.md was copied) — a real possible state.
    mkdirSync(join(testHome, '.claude/skills/workos'), { recursive: true });

    const result = await checkSkills(testHome);

    expect(result).not.toBeNull();
    expect(result!.bundledVersion).toBe('0.3.0');
    expect(result!.agents).toEqual([{ agent: 'Claude Code', installedVersion: null, stale: false }]);
  });

  it('reports an agent that only has workos-widgets/ (older explicit install)', async () => {
    // workos-widgets is also on the FIXABLE_SKILLS allowlist; an agent that
    // installed only it via an older CLI version should still be visible.
    mkdirSync(join(testHome, '.claude/skills/workos-widgets'), { recursive: true });

    const result = await checkSkills(testHome);

    expect(result).not.toBeNull();
    expect(result!.agents).toEqual([{ agent: 'Claude Code', installedVersion: null, stale: false }]);
  });

  it('flags an agent as stale when the marker trails the bundled version', async () => {
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.2.4');

    const result = await checkSkills(testHome);

    expect(result!.agents).toEqual([{ agent: 'Claude Code', installedVersion: '0.2.4', stale: true }]);
  });

  it('does not flag stale when marker matches bundled', async () => {
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.3.0');

    const result = await checkSkills(testHome);

    expect(result!.agents[0].stale).toBe(false);
  });

  it('never flags stale when bundledVersion is null (unknown)', async () => {
    vi.mocked(getBundledSkillsVersion).mockResolvedValue(null);
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.2.4');

    const result = await checkSkills(testHome);

    expect(result!.bundledVersion).toBeNull();
    expect(result!.agents[0].stale).toBe(false);
  });

  it('does not flag stale when installed > bundled (downgrade scenario)', async () => {
    // String inequality would incorrectly fire here. Semver ordering must not.
    const skillsDir = join(testHome, '.claude/skills');
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, SKILL_VERSION_MARKER_FILENAME), '0.5.0');

    const result = await checkSkills(testHome);

    expect(result!.agents[0].installedVersion).toBe('0.5.0');
    expect(result!.agents[0].stale).toBe(false);
  });

  it('reports each detected agent separately', async () => {
    mkdirSync(join(testHome, '.claude/skills'), { recursive: true });
    writeFileSync(join(testHome, '.claude/skills', SKILL_VERSION_MARKER_FILENAME), '0.2.4');
    mkdirSync(join(testHome, '.codex/skills'), { recursive: true });
    writeFileSync(join(testHome, '.codex/skills', SKILL_VERSION_MARKER_FILENAME), '0.3.0');

    const result = await checkSkills(testHome);

    expect(result!.agents).toHaveLength(2);
    const claude = result!.agents.find((a) => a.agent === 'Claude Code')!;
    const codex = result!.agents.find((a) => a.agent === 'Codex')!;
    expect(claude.stale).toBe(true);
    expect(codex.stale).toBe(false);
  });
});
