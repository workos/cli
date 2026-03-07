import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import { createAgents, detectAgents, discoverSkills, getSkillsDir, type AgentConfig } from './install-skill.js';

export interface UninstallSkillOptions {
  list?: boolean;
  skill?: string[];
  agent?: string[];
}

export function findInstalledSkills(knownSkills: string[], agent: AgentConfig): string[] {
  return knownSkills.filter((name) => existsSync(join(agent.globalSkillsDir, name, 'SKILL.md')));
}

export async function uninstallSkill(
  skillName: string,
  agent: AgentConfig,
): Promise<{ success: boolean; error?: string }> {
  const targetDir = join(agent.globalSkillsDir, skillName);
  try {
    await rm(targetDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function runUninstallSkill(options: UninstallSkillOptions): Promise<void> {
  const home = homedir();
  const agents = createAgents(home);
  const skillsDir = getSkillsDir();
  const knownSkills = await discoverSkills(skillsDir);

  const targetAgents = detectAgents(agents, options.agent);

  if (targetAgents.length === 0) {
    if (options.agent) {
      console.error(chalk.red('Specified agents not found.'));
    } else {
      console.error(chalk.red('No coding agents detected.'));
    }
    console.log('Supported agents:', Object.keys(agents).join(', '));
    process.exit(1);
  }

  if (options.list) {
    console.log(chalk.bold('\nInstalled WorkOS Skills:\n'));
    for (const agent of targetAgents) {
      const installed = findInstalledSkills(knownSkills, agent);
      console.log(`  ${chalk.bold(agent.displayName)}:`);
      if (installed.length === 0) {
        console.log(`    ${chalk.dim('(none)')}`);
      } else {
        for (const skill of installed) {
          console.log(`    ${chalk.cyan(skill)}`);
        }
      }
    }
    console.log();
    return;
  }

  const targetSkillNames = options.skill ? knownSkills.filter((s) => options.skill!.includes(s)) : knownSkills;

  if (options.skill && targetSkillNames.length === 0) {
    console.error(chalk.red('No matching skills found.'));
    console.log('Known skills:', knownSkills.join(', '));
    process.exit(1);
  }

  console.log(chalk.bold('\nUninstalling skills...\n'));

  const results: Array<{
    skill: string;
    agent: string;
    success: boolean;
    skipped: boolean;
    error?: string;
  }> = [];

  for (const skill of targetSkillNames) {
    for (const agent of targetAgents) {
      const isInstalled = existsSync(join(agent.globalSkillsDir, skill, 'SKILL.md'));
      if (!isInstalled) {
        results.push({ skill, agent: agent.displayName, success: true, skipped: true });
        continue;
      }
      const result = await uninstallSkill(skill, agent);
      results.push({
        skill,
        agent: agent.displayName,
        skipped: false,
        ...result,
      });
    }
  }

  const removed = results.filter((r) => r.success && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.success);

  if (removed.length > 0) {
    console.log(chalk.green(`✓ Removed ${removed.length} skill(s):\n`));
    for (const r of removed) {
      console.log(`  ${chalk.cyan(r.skill)} ← ${chalk.dim(r.agent)}`);
    }
  }

  if (skipped.length > 0 && removed.length === 0 && failed.length === 0) {
    console.log(chalk.dim('No WorkOS skills were installed.'));
  }

  if (failed.length > 0) {
    console.log(chalk.red(`\n✗ Failed to remove ${failed.length}:\n`));
    for (const r of failed) {
      console.log(`  ${r.skill} ← ${r.agent}: ${chalk.dim(r.error)}`);
    }
    process.exit(1);
  }

  console.log(chalk.green('\nDone!'));
}
