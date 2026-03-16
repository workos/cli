import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDefaultBranch, getUncommittedFiles } from '../utils/git-utils.js';

export function detectChanges(): { hasChanges: boolean; files: string[] } {
  const files = getUncommittedFiles();
  return { hasChanges: files.length > 0, files };
}

export function stageAndCommit(message: string, cwd: string): void {
  execFileSync('git', ['add', '-A'], { cwd, stdio: 'ignore' });
  try {
    execFileSync('git', ['commit', '-m', message], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error: unknown) {
    const execError = error as { stderr?: Buffer; stdout?: Buffer; message?: string };
    const stderr = execError.stderr?.toString() ?? '';
    const stdout = execError.stdout?.toString() ?? '';
    throw new Error(
      `Git commit failed${stderr ? `:\n${stderr}` : stdout ? `:\n${stdout}` : `: ${execError.message}`}`,
    );
  }
}

export function pushBranch(cwd: string): void {
  execFileSync('git', ['push', '-u', 'origin', 'HEAD'], { cwd, stdio: 'pipe' });
}

export function createPullRequest(title: string, body: string, cwd: string): string {
  const baseBranch = getDefaultBranch();
  const tmpFile = join(tmpdir(), `pr-body-${Date.now()}.md`);
  writeFileSync(tmpFile, body, 'utf-8');

  try {
    return execFileSync('gh', ['pr', 'create', '--title', title, '--body-file', tmpFile, '--base', baseBranch], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .toString()
      .trim();
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {}
  }
}

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
