import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCurrentBranch, getDefaultBranch, hasGhCli, getUncommittedFiles } from '../utils/git-utils.js';

export interface PostInstallContext {
  installDir: string;
  integration: string;
  commitMessage?: string;
  prDescription?: string;
  prUrl?: string;
}

/**
 * Detect uncommitted changes in the working directory.
 */
export function detectChanges(): { hasChanges: boolean; files: string[] } {
  const files = getUncommittedFiles();
  return { hasChanges: files.length > 0, files };
}

/**
 * Stage all changes and commit with the given message.
 * Uses execFileSync for shell injection safety.
 */
export function stageAndCommit(message: string, cwd: string): void {
  // Stage all changes
  execFileSync('git', ['add', '-A'], { cwd, stdio: 'ignore' });
  // Commit with message as argument (safe from injection)
  execFileSync('git', ['commit', '-m', message], { cwd, stdio: 'ignore' });
}

/**
 * Push the current branch to origin.
 */
export function pushBranch(cwd: string): void {
  execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd, stdio: 'pipe' });
}

/**
 * Create a pull request using GitHub CLI.
 * Writes body to temp file to avoid escaping issues.
 * Returns the PR URL.
 */
export async function createPullRequest(title: string, body: string, cwd: string): Promise<string> {
  const baseBranch = getDefaultBranch();

  // Write body to temp file to avoid any escaping issues
  const tmpFile = join(tmpdir(), `pr-body-${Date.now()}.md`);
  writeFileSync(tmpFile, body, 'utf-8');

  try {
    const result = execFileSync(
      'gh',
      ['pr', 'create', '--title', title, '--body-file', tmpFile, '--base', baseBranch],
      { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
    )
      .toString()
      .trim();

    return result; // Returns PR URL
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

/**
 * Get manual instructions for creating a PR without gh CLI.
 */
export function getManualPrInstructions(branch: string): string {
  const baseBranch = getDefaultBranch();
  return `
To create a PR manually:

1. Push your branch:
   git push -u origin ${branch}

2. Create PR via GitHub:
   https://github.com/<owner>/<repo>/compare/${baseBranch}...${branch}

Or install the GitHub CLI:
   https://cli.github.com/
`.trim();
}
