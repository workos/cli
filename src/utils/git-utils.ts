import { execSync } from 'node:child_process';

const PROTECTED_BRANCHES = ['main', 'master', 'develop'];

/**
 * Get the current git branch name.
 * Returns null if not in a git repo or if the command fails.
 */
export function getCurrentBranch(): string | null {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return null;
  }
}

/**
 * Check if a branch name is considered protected (main, master, develop).
 */
export function isProtectedBranch(branch: string): boolean {
  return PROTECTED_BRANCHES.includes(branch);
}

export function createBranch(name: string): void {
  execSync(`git checkout -b ${name}`, { stdio: 'ignore' });
}

export function branchExists(name: string): boolean {
  try {
    execSync(`git rev-parse --verify ${name}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the default branch from origin, falling back to main/master detection.
 */
export function getDefaultBranch(): string {
  try {
    const ref = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    return ref.replace('refs/remotes/origin/', '');
  } catch {
    if (branchExists('main')) return 'main';
    if (branchExists('master')) return 'master';
    return 'main';
  }
}

/**
 * Check if the GitHub CLI (gh) is available.
 */
export function hasGhCli(): boolean {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get list of uncommitted/untracked files from git status.
 */
export function getUncommittedFiles(): string[] {
  try {
    const status = execSync('git status --porcelain', {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString();
    return status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
  } catch {
    return [];
  }
}
