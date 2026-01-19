import { homedir } from 'os';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { mkdir, copyFile, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

export interface AgentConfig {
  name: string;
  displayName: string;
  globalSkillsDir: string;
  detect: () => boolean;
}

export function createAgents(home: string): Record<string, AgentConfig> {
  return {
    'claude-code': {
      name: 'claude-code',
      displayName: 'Claude Code',
      globalSkillsDir: join(home, '.claude/skills'),
      detect: () => existsSync(join(home, '.claude')),
    },
    codex: {
      name: 'codex',
      displayName: 'Codex',
      globalSkillsDir: join(home, '.codex/skills'),
      detect: () => existsSync(join(home, '.codex')),
    },
    cursor: {
      name: 'cursor',
      displayName: 'Cursor',
      globalSkillsDir: join(home, '.cursor/skills'),
      detect: () => existsSync(join(home, '.cursor')),
    },
    goose: {
      name: 'goose',
      displayName: 'Goose',
      globalSkillsDir: join(home, '.config/goose/skills'),
      detect: () => existsSync(join(home, '.config/goose')),
    },
  };
}

export interface InstallSkillOptions {
  list?: boolean;
  skill?: string[];
  agent?: string[];
}

export function getSkillsDir(): string {
  const currentFile = fileURLToPath(import.meta.url);
  // From dist/src/commands/install-skill.js -> skills/
  return join(dirname(currentFile), '..', '..', '..', 'skills');
}

export async function discoverSkills(skillsDir: string): Promise<string[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });

  return entries
    .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
    .map((e) => e.name);
}

export function detectAgents(
  agents: Record<string, AgentConfig>,
  filter?: string[],
): AgentConfig[] {
  const detected: AgentConfig[] = [];

  for (const [key, config] of Object.entries(agents)) {
    if (filter && !filter.includes(key)) continue;
    if (config.detect()) {
      detected.push(config);
    }
  }

  return detected;
}

export async function installSkill(
  skillsDir: string,
  skillName: string,
  agent: AgentConfig,
): Promise<{ success: boolean; error?: string }> {
  const sourceFile = join(skillsDir, skillName, 'SKILL.md');
  const targetDir = join(agent.globalSkillsDir, skillName);
  const targetFile = join(targetDir, 'SKILL.md');

  try {
    await mkdir(targetDir, { recursive: true });
    await copyFile(sourceFile, targetFile);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function runInstallSkill(options: InstallSkillOptions): Promise<void> {
  const home = homedir();
  const agents = createAgents(home);
  const skillsDir = getSkillsDir();
  const skills = await discoverSkills(skillsDir);

  if (options.list) {
    console.log(chalk.bold('\nAvailable Skills:\n'));
    for (const skill of skills) {
      console.log(`  ${chalk.cyan(skill)}`);
    }
    console.log();
    return;
  }

  const targetSkills = options.skill ? skills.filter((s) => options.skill!.includes(s)) : skills;

  if (targetSkills.length === 0) {
    console.error(chalk.red('No matching skills found.'));
    console.log('Available skills:', skills.join(', '));
    process.exit(1);
  }

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

  console.log(chalk.bold('\nInstalling skills...\n'));

  const results: Array<{ skill: string; agent: string; success: boolean; error?: string }> = [];

  for (const skill of targetSkills) {
    for (const agent of targetAgents) {
      const result = await installSkill(skillsDir, skill, agent);
      results.push({
        skill,
        agent: agent.displayName,
        ...result,
      });
    }
  }

  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (successful.length > 0) {
    console.log(chalk.green(`✓ Installed ${successful.length} skill(s):\n`));
    for (const r of successful) {
      console.log(`  ${chalk.cyan(r.skill)} → ${chalk.dim(r.agent)}`);
    }
  }

  if (failed.length > 0) {
    console.log(chalk.red(`\n✗ Failed to install ${failed.length}:\n`));
    for (const r of failed) {
      console.log(`  ${r.skill} → ${r.agent}: ${chalk.dim(r.error)}`);
    }
    process.exit(1);
  }

  console.log(chalk.green('\nDone!'));
}
