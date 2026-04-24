import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createAgents, getBundledSkillsVersion, SKILL_VERSION_MARKER_FILENAME } from '../../commands/install-skill.js';
import type { SkillsInfo, SkillAgentStatus } from '../types.js';

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
    // Only report on agents that actually have our skills dir laid down.
    // An agent directory existing (e.g. ~/.claude) doesn't imply we installed.
    if (!existsSync(agent.globalSkillsDir)) continue;

    const markerPath = join(agent.globalSkillsDir, SKILL_VERSION_MARKER_FILENAME);
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
      stale: Boolean(bundledVersion && installedVersion && installedVersion !== bundledVersion),
    });
  }

  if (statuses.length === 0) return null;

  return {
    bundledVersion,
    agents: statuses,
  };
}
