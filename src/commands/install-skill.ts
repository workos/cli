import { homedir } from 'os';
import { dirname, join, relative, sep } from 'path';
import { existsSync } from 'fs';
import { mkdir, mkdtemp, cp, rename, rm, readdir, readFile, stat, access, writeFile } from 'fs/promises';
import chalk from 'chalk';
import { getSkillsDir as getSkillsPackageDir } from '@workos/skills';
import { IS_WINDOWS } from '../utils/platform.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import { EMBEDDED_SKILLS, EMBEDDED_SKILLS_VERSION } from '../lib/sdk-runtime/embedded-assets.js';

export const SKILL_VERSION_MARKER_FILENAME = '.workos-skill-version';

// Stale-orphan cutoff for `.workos.tmp-*` / `.workos.bak-*` siblings left behind
// by a crashed prior run. Anything younger may belong to a concurrent install
// and must NOT be removed.
const ORPHAN_STALE_MS = 60 * 60 * 1000;

/** Async equivalent of `existsSync` — `access` rejects with ENOENT when missing. */
async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the bundled @workos/skills version by walking up from the skills
 * directory to the package.json. The package's `exports` map doesn't expose
 * package.json, so we resolve it by filesystem convention.
 * Returns null if the version can't be determined — callers treat that as
 * "no marker written" rather than failing the install.
 */
export async function getBundledSkillsVersion(skillsDir: string = getSkillsPackageDir()): Promise<string | null> {
  try {
    // skillsDir = <packageRoot>/plugins/workos/skills
    const packageRoot = dirname(dirname(dirname(skillsDir)));
    const pkgJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
    return typeof pkgJson.version === 'string' ? pkgJson.version : null;
  } catch {
    return null;
  }
}

export interface AgentConfig {
  name: string;
  displayName: string;
  globalSkillsDir: string;
  detect: () => boolean;
}

export function createAgents(home: string): Record<string, AgentConfig> {
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  return {
    'claude-code': {
      name: 'claude-code',
      displayName: 'Claude Code',
      globalSkillsDir: join(home, '.claude', 'skills'),
      detect: () => existsSync(join(home, '.claude')),
    },
    codex: {
      name: 'codex',
      displayName: 'Codex',
      globalSkillsDir: join(home, '.codex', 'skills'),
      detect: () => existsSync(join(home, '.codex')),
    },
    cursor: {
      name: 'cursor',
      displayName: 'Cursor',
      globalSkillsDir: join(home, '.cursor', 'skills'),
      detect: () => existsSync(join(home, '.cursor')),
    },
    goose: {
      name: 'goose',
      displayName: 'Goose',
      globalSkillsDir: IS_WINDOWS ? join(appData, 'goose', 'skills') : join(home, '.config', 'goose', 'skills'),
      detect: () => (IS_WINDOWS ? existsSync(join(appData, 'goose')) : existsSync(join(home, '.config', 'goose'))),
    },
  };
}

export interface InstallSkillOptions {
  skill?: string[];
  agent?: string[];
}

/**
 * Where bundled skill content comes from:
 * - `dir`: the @workos/skills package tree in node_modules (dev / npm install)
 * - `map`: the EMBEDDED_SKILLS base64 file map baked into a compiled binary
 *   (keys relative to the package root, e.g.
 *   `plugins/workos/skills/workos/SKILL.md`). Installs write decoded files
 *   straight into the target temp dir — no intermediate extraction.
 */
export type SkillSource = { kind: 'dir'; dir: string } | { kind: 'map'; files: Record<string, string> };

const SKILLS_KEY_PREFIX = 'plugins/workos/skills/';

/** Skill-local dirs that are dev tooling, not skill content — never installed. */
const EXCLUDED_SKILL_DIRS = new Set(['evals']);

export function resolveSkillSource(): SkillSource {
  return EMBEDDED_SKILLS ? { kind: 'map', files: EMBEDDED_SKILLS } : { kind: 'dir', dir: getSkillsPackageDir() };
}

/** Human-readable source location for error messages. */
export function describeSkillSource(source: SkillSource): string {
  return source.kind === 'dir' ? source.dir : 'embedded skills (compiled binary)';
}

/**
 * Bundled skills version: compiled binaries embed it at build time; dev walks
 * up from the package skills dir to package.json.
 */
export async function resolveBundledSkillsVersion(
  source: SkillSource,
  embeddedVersion: string | null = EMBEDDED_SKILLS_VERSION,
): Promise<string | null> {
  return source.kind === 'map' ? embeddedVersion : getBundledSkillsVersion(source.dir);
}

export async function discoverSkills(source: SkillSource): Promise<string[]> {
  if (source.kind === 'map') {
    const names = new Set<string>();
    for (const key of Object.keys(source.files)) {
      if (!key.startsWith(SKILLS_KEY_PREFIX)) continue;
      const name = key.slice(SKILLS_KEY_PREFIX.length).split('/')[0];
      if (source.files[`${SKILLS_KEY_PREFIX}${name}/SKILL.md`]) {
        names.add(name);
      }
    }
    return [...names];
  }

  const entries = await readdir(source.dir, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory());
  const checks = await Promise.all(dirs.map((e) => pathExists(join(source.dir, e.name, 'SKILL.md'))));
  return dirs.filter((_, i) => checks[i]).map((e) => e.name);
}

export function detectAgents(agents: Record<string, AgentConfig>, filter?: string[]): AgentConfig[] {
  const detected: AgentConfig[] = [];

  for (const [key, config] of Object.entries(agents)) {
    if (filter && !filter.includes(key)) continue;
    if (config.detect()) {
      detected.push(config);
    }
  }

  return detected;
}

/**
 * Recursively install a skill directory (SKILL.md + references/ + any other
 * files) with prune-replace semantics. Uses a sibling temp dir + backup-rename
 * pattern so the operation is effectively atomic per skill: the target either
 * matches the source exactly, or (on rollback) is restored to its prior state.
 *
 * Returns `{ success, error }` rather than throwing — callers (autoInstallSkills,
 * runInstallSkill) accumulate failures across the (skill × agent) matrix.
 */
export async function installSkill(
  source: SkillSource,
  skillName: string,
  agent: AgentConfig,
): Promise<{ success: boolean; error?: string }> {
  const targetDir = join(agent.globalSkillsDir, skillName);
  const parent = dirname(targetDir);

  // Setup (mkdir parent, mkdtemp) is inside the try so EACCES / ENOTDIR / etc.
  // surface as `{ success: false }` rather than rejecting — runInstallSkill and
  // refreshWorkOSSkills accumulate failures across the (skill × agent) matrix
  // and would otherwise abort the whole batch on a single bad agent dir.
  let tempDir: string | undefined;
  try {
    await mkdir(parent, { recursive: true });
    // Best-effort cleanup of OLD orphans only — never current-run paths.
    await cleanupStaleOrphans(parent, skillName).catch(() => {});

    // mkdtemp gives us atomic creation + a random suffix that prevents
    // collisions between concurrent installers.
    tempDir = await mkdtemp(join(parent, `.workos.tmp-${skillName}-`));
    const backupDir = tempDir.replace('.workos.tmp-', '.workos.bak-');

    await writeSkillTree(source, skillName, tempDir);

    const targetExisted = await pathExists(targetDir);
    if (targetExisted) {
      await rename(targetDir, backupDir);
    }
    try {
      await rename(tempDir, targetDir);
    } catch (renameErr) {
      if (targetExisted) {
        await rename(backupDir, targetDir).catch(() => {});
      }
      throw renameErr;
    }
    // Backup cleanup is best-effort: target is already in place, so failure
    // here leaves a stale backup that the next run's cleanup handles after 1h.
    if (targetExisted) {
      await rm(backupDir, { recursive: true, force: true }).catch(() => {});
    }
    return { success: true };
  } catch (error) {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Write one skill's content tree into `destDir`, excluding dev-tooling dirs
 * (EXCLUDED_SKILL_DIRS). Dir source copies; map source decodes base64 entries
 * directly to disk — files only ever exist at the install destination.
 */
async function writeSkillTree(source: SkillSource, skillName: string, destDir: string): Promise<void> {
  if (source.kind === 'dir') {
    const sourceDir = join(source.dir, skillName);
    await cp(sourceDir, destDir, {
      recursive: true,
      errorOnExist: false,
      filter: (src) => {
        const rel = relative(sourceDir, src);
        return rel === '' || !EXCLUDED_SKILL_DIRS.has(rel.split(sep)[0]);
      },
    });
    return;
  }

  const prefix = `${SKILLS_KEY_PREFIX}${skillName}/`;
  let wrote = false;
  for (const [key, base64] of Object.entries(source.files)) {
    if (!key.startsWith(prefix)) continue;
    const rel = key.slice(prefix.length);
    if (EXCLUDED_SKILL_DIRS.has(rel.split('/')[0])) continue;
    const dest = join(destDir, ...rel.split('/'));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, Buffer.from(base64, 'base64'));
    wrote = true;
  }
  if (!wrote) {
    throw new Error(`Skill "${skillName}" not found in embedded skills`);
  }
}

/**
 * Remove `.workos.tmp-{skillName}-*` and `.workos.bak-{skillName}-*` siblings
 * older than ORPHAN_STALE_MS. Fresh siblings (from a concurrent install) are
 * preserved — destroying them would race the other run's final rename.
 */
async function cleanupStaleOrphans(parent: string, skillName: string): Promise<void> {
  if (!(await pathExists(parent))) return;
  const entries = await readdir(parent).catch(() => []);
  const cutoff = Date.now() - ORPHAN_STALE_MS;
  for (const entry of entries) {
    const isOrphan = entry.startsWith(`.workos.tmp-${skillName}-`) || entry.startsWith(`.workos.bak-${skillName}-`);
    if (!isOrphan) continue;
    const path = join(parent, entry);
    const st = await stat(path).catch(() => null);
    if (st && st.mtimeMs < cutoff) {
      await rm(path, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function runInstallSkill(options: InstallSkillOptions): Promise<void> {
  const home = homedir();
  const agents = createAgents(home);
  const source = resolveSkillSource();
  const skills = await discoverSkills(source);

  const targetSkills = options.skill ? skills.filter((s) => options.skill!.includes(s)) : skills;

  if (targetSkills.length === 0) {
    console.error(chalk.red('No matching skills found.'));
    console.log('Available skills:', skills.join(', '));
    exitWithCode(ExitCode.GENERAL_ERROR);
  }

  const targetAgents = detectAgents(agents, options.agent);

  if (targetAgents.length === 0) {
    if (options.agent) {
      console.error(chalk.red('Specified agents not found.'));
    } else {
      console.error(chalk.red('No coding agents detected.'));
    }
    console.log('Supported agents:', Object.keys(agents).join(', '));
    exitWithCode(ExitCode.GENERAL_ERROR);
  }

  console.log(chalk.bold('\nInstalling skills...\n'));

  const results: Array<{
    skill: string;
    agent: AgentConfig;
    success: boolean;
    error?: string;
  }> = [];

  for (const skill of targetSkills) {
    for (const agent of targetAgents) {
      const result = await installSkill(source, skill, agent);
      results.push({ skill, agent, ...result });
    }
  }

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log(chalk.green(`✓ Installed ${successful.length} skill(s):\n`));
    for (const r of successful) {
      console.log(`  ${chalk.cyan(r.skill)} → ${chalk.dim(r.agent.displayName)}`);
    }
  }

  // Write per-agent version markers for any agent that had at least one
  // successful install, so `workos doctor` doesn't immediately flag the
  // freshly-installed skills as stale or missing. Same primitive as
  // refreshWorkOSSkills — single source of truth for marker semantics.
  const version = await resolveBundledSkillsVersion(source);
  if (version) {
    const succeededAgents = new Set<AgentConfig>();
    for (const r of successful) succeededAgents.add(r.agent);
    for (const agent of succeededAgents) {
      await writeAgentSkillMarker(agent, version);
    }
  }

  if (failed.length > 0) {
    console.log(chalk.red(`\n✗ Failed to install ${failed.length}:\n`));
    for (const r of failed) {
      console.log(`  ${r.skill} → ${r.agent.displayName}: ${chalk.dim(r.error)}`);
    }
    exitWithCode(ExitCode.GENERAL_ERROR);
  }

  console.log(chalk.green('\nDone!'));
}

export interface AutoInstallResult {
  skills: string[];
  agents: string[];
  version: string | null;
}

export interface RefreshOptions {
  /** Pre-detected agents. Default: detect from $HOME. */
  agents?: AgentConfig[];
  /** Skill names to install. Default: all bundled skills. */
  skills?: string[];
  /** Whether to write the version marker after a successful per-agent install. Default: true. */
  writeMarker?: boolean;
}

export interface RefreshResult {
  /** Agents where at least one skill installed successfully. */
  agents: AgentConfig[];
  /** Skills that were attempted (the resolved set after filtering). */
  skills: string[];
  /** Bundled skills package version, or null if it couldn't be resolved. */
  version: string | null;
  /** Marker version per agent.name BEFORE refresh (null = no marker / unreadable). */
  perAgentBefore: Record<string, string | null>;
  /** Marker version per agent.name AFTER refresh. */
  perAgentAfter: Record<string, string | null>;
}

async function readSkillVersionMarker(agent: AgentConfig): Promise<string | null> {
  const path = join(agent.globalSkillsDir, SKILL_VERSION_MARKER_FILENAME);
  try {
    return (await readFile(path, 'utf8')).trim() || null;
  } catch {
    return null;
  }
}

/**
 * Best-effort marker write — any failure is swallowed (filesystem permission
 * errors shouldn't fail the install; doctor treats missing markers as "unknown").
 * Single source of truth for the .workos-skill-version write semantics.
 */
async function writeAgentSkillMarker(agent: AgentConfig, version: string): Promise<void> {
  try {
    await writeFile(join(agent.globalSkillsDir, SKILL_VERSION_MARKER_FILENAME), version, 'utf8');
  } catch {
    // Marker is best-effort; doctor treats missing marker as "unknown".
  }
}

/**
 * Reusable primitive: discover bundled skills, install each one to each agent,
 * write per-agent version markers, and report before/after marker state.
 *
 * Both `autoInstallSkills` (best-effort hook called from install/login) and
 * `doctor --fix` (Phase 3) call this — there is no duplicate copy logic.
 *
 * Returns null when nothing applied (no agents detected, no skills found, or
 * every install attempt failed).
 */
export async function refreshWorkOSSkills(opts: RefreshOptions = {}): Promise<RefreshResult | null> {
  const home = homedir();
  const source = resolveSkillSource();
  const detected = opts.agents ?? detectAgents(createAgents(home));
  const allSkills = await discoverSkills(source).catch(() => []);
  const skills = opts.skills ? allSkills.filter((s) => opts.skills!.includes(s)) : allSkills;
  const writeMarker = opts.writeMarker ?? true;

  if (skills.length === 0 || detected.length === 0) return null;

  const version = await resolveBundledSkillsVersion(source);
  const perAgentBefore: Record<string, string | null> = {};
  const perAgentAfter: Record<string, string | null> = {};
  const succeededAgents: AgentConfig[] = [];
  // Union of skills that succeeded for at least one agent. Returning the full
  // attempted list would inflate "Installed N skills" copy when some skills
  // failed to copy; only count what actually landed somewhere.
  const installedSkills = new Set<string>();

  for (const agent of detected) {
    perAgentBefore[agent.name] = await readSkillVersionMarker(agent);

    let agentSucceeded = false;
    for (const skill of skills) {
      const result = await installSkill(source, skill, agent);
      if (result.success) {
        agentSucceeded = true;
        installedSkills.add(skill);
      }
    }

    if (agentSucceeded) {
      succeededAgents.push(agent);
      if (writeMarker && version) {
        await writeAgentSkillMarker(agent, version);
      }
    }

    perAgentAfter[agent.name] = await readSkillVersionMarker(agent);
  }

  if (succeededAgents.length === 0) return null;

  return {
    agents: succeededAgents,
    skills: skills.filter((s) => installedSkills.has(s)),
    version,
    perAgentBefore,
    perAgentAfter,
  };
}

/**
 * Install all bundled skills to all detected coding agents.
 * Returns a summary when anything was installed, or null when nothing applied.
 * Performs minimal IO: writes a version marker file alongside installed
 * skills so `workos doctor` can detect staleness later. Errors are swallowed
 * so skill install never disrupts the calling flow.
 *
 * Thin back-compat wrapper around `refreshWorkOSSkills` — the install/auth-login
 * call sites use this; doctor `--fix` (Phase 3) calls `refreshWorkOSSkills`
 * directly to surface the per-agent before/after marker state.
 */
export async function autoInstallSkills(): Promise<AutoInstallResult | null> {
  try {
    const result = await refreshWorkOSSkills();
    if (!result) return null;
    return {
      skills: result.skills,
      agents: result.agents.map((a) => a.displayName),
      version: result.version,
    };
  } catch {
    return null;
  }
}
