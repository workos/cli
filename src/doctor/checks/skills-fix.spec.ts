import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { SkillsInfo } from '../types.js';

// Mock the two collaborators maybeRefreshSkills depends on.
vi.mock('../../commands/install-skill.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../commands/install-skill.js')>();
  return {
    ...actual,
    refreshWorkOSSkills: vi.fn(),
  };
});

vi.mock('./skills.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./skills.js')>();
  return {
    ...actual,
    checkSkills: vi.fn(),
  };
});

const { refreshWorkOSSkills } = await import('../../commands/install-skill.js');
const { checkSkills } = await import('./skills.js');
const { maybeRefreshSkills, FIXABLE_SKILLS } = await import('../index.js');

const STALE: SkillsInfo = {
  bundledVersion: '0.4.0',
  agents: [
    { agent: 'Claude Code', installedVersion: '0.2.4', stale: true },
    { agent: 'Codex', installedVersion: null, stale: false },
  ],
};

const CURRENT: SkillsInfo = {
  bundledVersion: '0.4.0',
  agents: [
    { agent: 'Claude Code', installedVersion: '0.4.0', stale: false },
    { agent: 'Codex', installedVersion: '0.4.0', stale: false },
  ],
};

describe('maybeRefreshSkills', () => {
  beforeEach(() => {
    vi.mocked(refreshWorkOSSkills).mockReset();
    vi.mocked(checkSkills).mockReset();
  });

  it('does NOT call refresh when fix=false even with stale skills', async () => {
    const result = await maybeRefreshSkills({ fix: false }, STALE);

    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    expect(checkSkills).not.toHaveBeenCalled();
    expect(result.skillsRefresh).toBeUndefined();
    expect(result.skills).toBe(STALE);
  });

  it('does NOT call refresh when skills info is undefined', async () => {
    const result = await maybeRefreshSkills({ fix: true }, undefined);

    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    expect(result.skillsRefresh).toBeUndefined();
    expect(result.skills).toBeUndefined();
  });

  it('does NOT call refresh when no agent is stale or missing-marker', async () => {
    const result = await maybeRefreshSkills({ fix: true }, CURRENT);

    expect(refreshWorkOSSkills).not.toHaveBeenCalled();
    expect(result.skillsRefresh).toBeUndefined();
    expect(result.skills).toBe(CURRENT);
  });

  it('passes ONLY the FIXABLE_SKILLS allowlist into refreshWorkOSSkills', async () => {
    vi.mocked(refreshWorkOSSkills).mockResolvedValueOnce(null);

    await maybeRefreshSkills({ fix: true }, STALE);

    expect(refreshWorkOSSkills).toHaveBeenCalledOnce();
    expect(refreshWorkOSSkills).toHaveBeenCalledWith({
      skills: [...FIXABLE_SKILLS],
    });
    expect(FIXABLE_SKILLS).toEqual(['workos', 'workos-widgets']);
  });

  it('returns skillsRefresh and post-refresh skills when refresh succeeds', async () => {
    vi.mocked(refreshWorkOSSkills).mockResolvedValueOnce({
      // refreshWorkOSSkills's return shape — only the fields maybeRefreshSkills reads matter here.
      agents: [],
      skills: ['workos', 'workos-widgets'],
      version: '0.4.0',
      perAgentBefore: { 'claude-code': '0.2.4', codex: null },
      perAgentAfter: { 'claude-code': '0.4.0', codex: '0.4.0' },
    });
    vi.mocked(checkSkills).mockResolvedValueOnce({
      bundledVersion: '0.4.0',
      agents: [
        { agent: 'Claude Code', installedVersion: '0.4.0', stale: false },
        { agent: 'Codex', installedVersion: '0.4.0', stale: false },
      ],
    });

    const result = await maybeRefreshSkills({ fix: true }, STALE);

    expect(result.skillsRefresh).toEqual({
      before: { 'claude-code': '0.2.4', codex: null },
      after: { 'claude-code': '0.4.0', codex: '0.4.0' },
      skillsInstalled: ['workos', 'workos-widgets'],
    });
    // Re-read happens, so post-refresh state replaces the original.
    expect(result.skills?.agents.every((a) => !a.stale)).toBe(true);
    expect(checkSkills).toHaveBeenCalledOnce();
  });

  it('returns the original skills (and no skillsRefresh) when refresh produces null', async () => {
    // refreshWorkOSSkills returns null when no agents detected or all installs failed.
    vi.mocked(refreshWorkOSSkills).mockResolvedValueOnce(null);

    const result = await maybeRefreshSkills({ fix: true }, STALE);

    expect(result.skillsRefresh).toBeUndefined();
    // Original skills preserved — we don't re-read on null refresh.
    expect(result.skills).toBe(STALE);
    expect(checkSkills).not.toHaveBeenCalled();
  });
});

describe('--fix sibling protection (integration via real refreshWorkOSSkills)', () => {
  let testDir: string;
  let homeDir: string;

  beforeEach(async () => {
    // The `vi.mock` calls above replace these for the unit-test suite;
    // restore them here so this suite uses the real implementations.
    vi.doUnmock('../../commands/install-skill.js');
    vi.doUnmock('./skills.js');
    vi.resetModules();

    testDir = mkdtempSync(join(tmpdir(), 'doctor-fix-sibling-'));
    homeDir = join(testDir, 'home');
    mkdirSync(homeDir);
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('only writes to skills on the FIXABLE_SKILLS allowlist; planted siblings are untouched', async () => {
    // Re-import after unmocking so we get the real impls. The real
    // refreshWorkOSSkills resolves its skill source via @workos/skills's
    // getSkillsDir(), so we cannot mock the source side here — the meaningful
    // assertion is target-side: pre-existing sibling skill dirs at the agent's
    // target path must NOT be touched, regardless of what's in the bundled
    // source. The opts.skills allowlist is what scopes refresh.
    const { refreshWorkOSSkills: realRefresh, createAgents } = await import('../../commands/install-skill.js');
    const { FIXABLE_SKILLS: realFixable } = await import('../index.js');

    const claudeSkillsDir = join(homeDir, '.claude/skills');
    mkdirSync(claudeSkillsDir, { recursive: true });

    // Third-party skill — must survive the refresh.
    mkdirSync(join(claudeSkillsDir, 'some-third-party-skill'));
    writeFileSync(join(claudeSkillsDir, 'some-third-party-skill', 'SKILL.md'), '# Third Party (do not touch)');

    // Hypothetical future bundled skill at the target but NOT on allowlist —
    // also must survive (allowlist defends both source-side and target-side).
    mkdirSync(join(claudeSkillsDir, 'workos-future-skill'));
    writeFileSync(join(claudeSkillsDir, 'workos-future-skill', 'SKILL.md'), '# Future (do not touch)');

    const explicitAgent = createAgents(homeDir)['claude-code'];
    const result = await realRefresh({
      agents: [explicitAgent],
      skills: [...realFixable],
      writeMarker: false,
    });

    expect(result).not.toBeNull();
    // The result.skills set is the intersection of allowlist and what's actually
    // bundled. workos and workos-widgets are both bundled today.
    expect(result!.skills.sort()).toEqual(['workos', 'workos-widgets']);

    // Allowlist names WERE installed.
    expect(existsSync(join(claudeSkillsDir, 'workos/SKILL.md'))).toBe(true);
    expect(existsSync(join(claudeSkillsDir, 'workos-widgets/SKILL.md'))).toBe(true);

    // Siblings (whether unrelated or hypothetical-future) are byte-identical.
    expect(readFileSync(join(claudeSkillsDir, 'some-third-party-skill/SKILL.md'), 'utf-8')).toBe(
      '# Third Party (do not touch)',
    );
    expect(readFileSync(join(claudeSkillsDir, 'workos-future-skill/SKILL.md'), 'utf-8')).toBe(
      '# Future (do not touch)',
    );
  });
});
