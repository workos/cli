import { existsSync } from 'fs';
import { rm } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import chalk from 'chalk';
import { logError, logInfo, logWarn } from '../utils/debug.js';
import { exitWithError, isJsonMode, outputJson } from '../utils/output.js';
import { createAgents, detectAgents, discoverSkills, getSkillsDir, type AgentConfig } from './install-skill.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';

export interface UninstallSkillOptions {
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
    const message = error instanceof Error ? error.message : 'Unknown error';
    logError(`Failed to remove skill "${skillName}" for ${agent.displayName} at ${targetDir}:`, message);
    return { success: false, error: message };
  }
}

export async function runUninstallSkill(options: UninstallSkillOptions): Promise<void> {
  const home = homedir();
  const agents = createAgents(home);
  const skillsDir = getSkillsDir();

  let knownSkills: string[];
  try {
    knownSkills = await discoverSkills(skillsDir);
  } catch (error) {
    logError('Failed to read skills directory:', error);
    exitWithError({
      code: 'SKILLS_DIR_READ_FAILED',
      message: `Could not read skills directory at ${skillsDir}. Your WorkOS CLI installation may be corrupted. Try reinstalling with \`npm install -g @workos-inc/cli\`.`,
    });
  }

  const targetAgents = detectAgents(agents, options.agent);

  if (targetAgents.length === 0) {
    const message = options.agent ? 'Specified agents not found.' : 'No coding agents detected.';
    logWarn(message, 'Supported agents:', Object.keys(agents).join(', '));
    exitWithError({
      code: 'NO_AGENTS_FOUND',
      message: `${message} Supported agents: ${Object.keys(agents).join(', ')}`,
    });
  }

  const targetSkillNames = options.skill ? knownSkills.filter((s) => options.skill!.includes(s)) : knownSkills;

  if (options.skill) {
    const unrecognized = options.skill.filter((s) => !knownSkills.includes(s));
    if (unrecognized.length > 0) {
      logWarn('Unrecognized skill names requested for uninstall:', unrecognized);
      if (!isJsonMode()) {
        console.warn(chalk.yellow(`Unknown skills (ignored): ${unrecognized.join(', ')}`));
      }
    }
  }

  if (options.skill && targetSkillNames.length === 0) {
    logError('No matching skills found. Known skills:', knownSkills.join(', '));
    exitWithError({
      code: 'SKILL_NOT_FOUND',
      message: `No matching skills found. Known skills: ${knownSkills.join(', ')}`,
    });
  }

  logInfo(
    'Uninstalling skills:',
    targetSkillNames.join(', '),
    'for agents:',
    targetAgents.map((a) => a.displayName).join(', '),
  );

  if (!isJsonMode()) {
    console.log(chalk.bold('\nUninstalling skills...\n'));
  }

  const results: Array<{
    skill: string;
    agent: string;
    success: boolean;
    skipped: boolean;
    error?: string;
  }> = [];

  for (const skill of targetSkillNames) {
    for (const agent of targetAgents) {
      const installed = findInstalledSkills([skill], agent);
      if (installed.length === 0) {
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

  if (isJsonMode()) {
    outputJson({ removed, skipped, failed });
    if (failed.length > 0) {
      exitWithCode(ExitCode.GENERAL_ERROR);
    }
    return;
  }

  if (removed.length > 0) {
    logInfo(`Removed ${removed.length} skill(s)`);
    console.log(chalk.green(`✓ Removed ${removed.length} skill(s):\n`));
    for (const r of removed) {
      console.log(`  ${chalk.cyan(r.skill)} ← ${chalk.dim(r.agent)}`);
    }
  }

  if (skipped.length > 0 && removed.length === 0 && failed.length === 0) {
    console.log(chalk.dim('No WorkOS skills were installed.'));
  }

  if (failed.length > 0) {
    logError(`Failed to remove ${failed.length} skill(s)`);
    console.log(chalk.red(`\n✗ Failed to remove ${failed.length}:\n`));
    for (const r of failed) {
      console.log(`  ${r.skill} ← ${r.agent}: ${chalk.dim(r.error)}`);
    }
    exitWithCode(ExitCode.GENERAL_ERROR);
  }

  console.log(chalk.green('\nDone!'));
}
