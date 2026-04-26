import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import semver from 'semver';
import { createAgents, getBundledSkillsVersion, SKILL_VERSION_MARKER_FILENAME } from '../../commands/install-skill.js';
import type { SkillsInfo, SkillAgentStatus } from '../types.js';

/**
 * Stale = installed version is strictly older than the bundled version.
 * String inequality would also fire when installed > bundled (user installed
 * via a newer CLI then downgraded), and the SKILLS_OUTDATED remediation would
 * silently downgrade their agent's skills. Use semver ordering so we only
 * recommend an update when the bundled set is actually ahead.
 *
 * Falls back to string inequality when either version can't be parsed as
 * semver — better to flag a possibly-stale skill than to ignore drift entirely.
 */
function isStale(installed: string, bundled: string): boolean {
  const installedValid = semver.valid(installed);
  const bundledValid = semver.valid(bundled);
  if (installedValid && bundledValid) {
    return semver.lt(installedValid, bundledValid);
  }
  return installed !== bundled;
}

/**
 * Check the freshness of auto-installed WorkOS skills across detected coding
 * agents. Compares each agent's version marker (written by autoInstallSkills)
 * against the bundled @workos/skills version the CLI ships with. Returns null
 * when no agents have a WorkOS skill installed at all — no noise for users who
 * never installed through the CLI.
 */
export function checkSkills(home: string = homedir()): SkillsInfo | null {
  const bundledVersion = getBundledSkillsVersion();
  const agents = createAgents(home);

  const statuses: SkillAgentStatus[] = [];

  for (const [, agent] of Object.entries(agents)) {
    // Only report on agents that actually have a WorkOS skill installed.
    // An agent's `skills/` dir existing (e.g. for unrelated user-installed
    // skills) doesn't mean WE installed — and `doctor --fix` would otherwise
    // happily write `workos/` and `workos-widgets/` onto an agent that never
    // opted in. The marker OR an existing `workos/` skill subdir is the signal.
    const markerPath = join(agent.globalSkillsDir, SKILL_VERSION_MARKER_FILENAME);
    const workosSkillDir = join(agent.globalSkillsDir, 'workos');
    if (!existsSync(markerPath) && !existsSync(workosSkillDir)) continue;

    let installedVersion: string | null = null;
    if (existsSync(markerPath)) {
      try {
        installedVersion = readFileSync(markerPath, 'utf8').trim() || null;
      } catch {
        installedVersion = null;
      }
    }

    statuses.push({
      agent: agent.displayName,
      installedVersion,
      stale: Boolean(bundledVersion && installedVersion && isStale(installedVersion, bundledVersion)),
    });
  }

  if (statuses.length === 0) return null;

  return {
    bundledVersion,
    agents: statuses,
  };
}
