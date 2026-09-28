import { execFileSync } from 'node:child_process';

export type ChangeDetection =
  | { state: 'changed' | 'unchanged'; files: string[] }
  | { state: 'not-git'; files: [] }
  | { state: 'error'; files: []; error: string };

/** Read the current tree, not an attribution of changes to the installer. Never touch the index. */
export function detectChanges(installDir: string): ChangeDetection {
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: installDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, LC_ALL: 'C' },
    });
  try {
    if (git(['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
      return { state: 'not-git', files: [] };
    }
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr ?? '';
    if (stderr.includes('not a git repository')) return { state: 'not-git', files: [] };
    return { state: 'error', files: [], error: error instanceof Error ? error.message : String(error) };
  }
  try {
    // NUL records preserve spaces, quotes, newlines and Unicode. Rename/copy
    // records contain a second (source) path; report the destination only.
    const records = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']).split('\0');
    const files: string[] = [];
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record) continue;
      files.push(record.slice(3));
      if (/[RC]/.test(record.slice(0, 2))) i++;
    }
    return { state: files.length ? 'changed' : 'unchanged', files };
  } catch (error) {
    return { state: 'error', files: [], error: error instanceof Error ? error.message : String(error) };
  }
}
