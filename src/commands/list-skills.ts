import { homedir } from 'os';
import chalk from 'chalk';
import { logError } from '../utils/debug.js';
import { exitWithError, isJsonMode, outputJson } from '../utils/output.js';
import { createAgents, detectAgents, discoverSkills, getSkillsDir } from './install-skill.js';
import { findInstalledSkills } from './uninstall-skill.js';

export interface ListSkillsOptions {
  agent?: string[];
}

export async function runListSkills(options: ListSkillsOptions): Promise<void> {
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

  const listData: Array<{ agent: string; available: string[]; installed: string[] }> = [];
  for (const agent of targetAgents) {
    const installed = findInstalledSkills(knownSkills, agent);
    listData.push({ agent: agent.displayName, available: knownSkills, installed });
  }

  if (isJsonMode()) {
    outputJson(listData);
    return;
  }

  console.log(chalk.bold('\nWorkOS Skills:\n'));
  console.log(`  ${chalk.bold('Available:')} ${knownSkills.map((s) => chalk.cyan(s)).join(', ')}\n`);

  if (targetAgents.length === 0) {
    console.log(chalk.dim('  No coding agents detected.\n'));
    return;
  }

  console.log(chalk.bold('  Installed per agent:\n'));
  for (const entry of listData) {
    console.log(`    ${chalk.bold(entry.agent)}:`);
    if (entry.installed.length === 0) {
      console.log(`      ${chalk.dim('(none)')}`);
    } else {
      for (const skill of entry.installed) {
        console.log(`      ${chalk.cyan(skill)}`);
      }
    }
  }
  console.log();
}
