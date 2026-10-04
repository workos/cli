import { execFileSync } from 'node:child_process';

export type ChangeDetection =
  | { state: 'changed' | 'unchanged'; files: string[] }
  | { state: 'not-git'; files: [] }
  | { state: 'error'; files: []; error: string };

// Completion is best-effort: at most two commands, each bounded independently.
// Never parse partial stdout after a timeout or buffer overflow as a complete list.
const GIT_TIMEOUT_MS = 5_000;
const GIT_MAX_BUFFER = 1024 * 1024;

function inspectionError(error: unknown): ChangeDetection {
  const code = (error as { code?: string } | null)?.code;
  const message =
    code === 'ETIMEDOUT'
      ? `Git change inspection timed out after ${GIT_TIMEOUT_MS} ms; changed files are unknown. Review the project manually.`
      : code === 'ENOBUFS'
        ? `Git change inspection exceeded the ${GIT_MAX_BUFFER}-byte output limit; changed files are unknown. Review the project manually.`
        : error instanceof Error
          ? error.message
          : String(error);
  return { state: 'error', files: [], error: message };
}

/** Read the current tree, not an attribution of changes to the installer. Never touch the index. */
export function detectChanges(installDir: string): ChangeDetection {
  const git = (args: string[]) =>
    execFileSync('git', args, {
      cwd: installDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: GIT_MAX_BUFFER,
      env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' },
    });
  try {
    if (git(['rev-parse', '--is-inside-work-tree']).trim() !== 'true') {
      return { state: 'not-git', files: [] };
    }
  } catch (error) {
    const { code, stderr } = (error ?? {}) as { code?: string; stderr?: string | null };
    // A resource limit is never evidence of a non-Git project, even if stderr
    // happens to contain that phrase before the process is terminated.
    if (code !== 'ETIMEDOUT' && code !== 'ENOBUFS' && (stderr ?? '').includes('not a git repository')) {
      return { state: 'not-git', files: [] };
    }
    return inspectionError(error);
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
    return inspectionError(error);
  }
}
