import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createActor, fromPromise, waitFor } from 'xstate';
import { detectChanges, type ChangeDetection } from './post-install.js';
import { installerMachine } from './installer-core.js';
import { createInstallerEventEmitter } from './events.js';
import { buildCompletionData } from './completion-data.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

let dir: string;
const git = (...args: string[]) => childProcess.execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

beforeEach(() => {
  dir = mkdtempSync(join(process.cwd(), '.auth6733-git-'));
  vi.stubEnv('HOME', dir);
  vi.stubEnv('GIT_CEILING_DIRECTORIES', process.cwd());
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  const gitConfig = join(dir, 'empty-gitconfig');
  writeFileSync(gitConfig, '');
  vi.stubEnv('GIT_CONFIG_GLOBAL', gitConfig);
  vi.stubEnv('GIT_AUTHOR_NAME', 'Offline Test');
  vi.stubEnv('GIT_AUTHOR_EMAIL', 'offline@example.test');
  vi.stubEnv('GIT_COMMITTER_NAME', 'Offline Test');
  vi.stubEnv('GIT_COMMITTER_EMAIL', 'offline@example.test');
});
afterEach(() => {
  vi.mocked(childProcess.execFileSync).mockReset();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function init() {
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'tracked.ts'), 'original');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
}

describe('read-only change inspection', () => {
  it('distinguishes a confirmed unchanged tree from a non-Git directory and a failed inspection', () => {
    expect(detectChanges(dir)).toEqual({ state: 'not-git', files: [] });
    expect(detectChanges(join(dir, 'missing'))).toMatchObject({ state: 'error', files: [], error: expect.any(String) });
    init();
    expect(detectChanges(dir)).toEqual({ state: 'unchanged', files: [] });
  });

  it('preserves tracked/untracked filenames and staged rename destinations, without touching the index', () => {
    init();
    const renamed = 'renamed → file.ts';
    git('mv', 'tracked.ts', renamed);
    const names = ['space name.ts', 'unicode-雪.ts'];
    for (const name of names) writeFileSync(join(dir, name), 'new');
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'untracked.ts'), 'new');
    const index = readFileSync(join(dir, '.git/index'));
    const result = detectChanges(dir);
    expect(result.state).toBe('changed');
    expect(result.files.sort()).toEqual([...names, renamed, 'nested/untracked.ts'].sort());
    expect(readFileSync(join(dir, '.git/index'))).toEqual(index);
    expect(detectChanges(join(dir, 'nested'))).toEqual({ state: 'changed', files: ['nested/untracked.ts'] });
  });

  it('parses exact NUL-delimited names including characters unavailable in Windows filenames', () => {
    const files = [' space.ts', 'line\nbreak.ts', 'quote".ts', 'unicode-雪.ts', 'renamed → "file".ts'];
    vi.spyOn(childProcess, 'execFileSync').mockImplementation((_cmd, args) =>
      args?.[0] === 'rev-parse'
        ? 'true\n'
        : files
            .slice(0, -1)
            .map((file) => `?? ${file}\0`)
            .join('') + `R  ${files.at(-1)}\0old\nname.ts\0`,
    );
    expect(detectChanges(dir)).toEqual({ state: 'changed', files });
  });

  it('does not call a status failure unchanged (and runs only read-only commands)', () => {
    const exec = vi.spyOn(childProcess, 'execFileSync').mockImplementation((_cmd, args) => {
      if (args?.[0] === 'rev-parse') return 'true\n';
      if (args?.[0] === 'status') throw new Error('permission denied');
      throw new Error('Forbidden execution');
    });
    expect(detectChanges(dir)).toEqual({ state: 'error', files: [], error: 'permission denied' });
    expect(exec.mock.calls.map(([cmd, args]) => [cmd, args])).toEqual([
      ['git', ['rev-parse', '--is-inside-work-tree']],
      ['git', ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.']],
    ]);
    expect(exec.mock.calls.every((call) => (call[2] as { cwd: string }).cwd === dir)).toBe(true);
  });

  it('distinguishes an unavailable Git executable from a non-Git project', () => {
    vi.spyOn(childProcess, 'execFileSync').mockImplementation(() => {
      throw new Error('spawn git ENOENT');
    });
    expect(detectChanges(dir)).toEqual({ state: 'error', files: [], error: 'spawn git ENOENT' });
  });
});

describe('real post-install state machine path', () => {
  it.each([
    { state: 'changed', files: ['existing.ts', 'new.ts'] },
    { state: 'unchanged', files: [] },
    { state: 'not-git', files: [] },
    { state: 'error', files: [], error: 'inspection failed' },
  ] satisfies ChangeDetection[])(
    'completes honestly with $state, even with legacy noCommit/createPr values',
    async (result) => {
      const emitter = createInstallerEventEmitter();
      const emitted = vi.spyOn(emitter, 'emit');
      const detect = vi.fn(() => result);
      const machine = installerMachine.provide({
        actors: {
          checkWorkspace: fromPromise(async () => ({
            scaffoldable: false,
            packageManager: 'npm',
            autoScaffold: false,
          })),
          detectIntegration: fromPromise(async () => ({ integration: 'nextjs' })),
          checkGitStatus: fromPromise(async () => ({ isClean: true, files: [] })),
          checkBranch: fromPromise(async () => ({ branch: 'feature', isProtected: false })),
          configureEnvironment: fromPromise(async () => {}),
          runAgent: fromPromise(async () => ({ success: true, summary: 'Fake agent completed validation' })),
          detectChanges: fromPromise(async ({ input }) => {
            expect(input.installDir).toBe(dir);
            return detect();
          }),
          buildCompletion: fromPromise(async ({ input: { context } }) =>
            buildCompletionData(
              {
                integration: context.integration!,
                installDir: context.options.installDir,
                changedFiles: context.changedFiles,
                changeDetection: context.changeDetection,
              },
              {
                resolveDevCommand: async () => ({ command: 'npm', args: ['run', 'dev'] }),
                detectPort: () => 3000,
                docsUrl: 'https://workos.com/docs',
                dashboardUrl: 'https://dashboard.workos.com',
              },
            ),
          ),
        },
      });
      const actor = createActor(machine, {
        input: {
          emitter,
          options: {
            installDir: dir,
            skipAuth: true,
            apiKey: 'offline',
            clientId: 'offline',
            noCommit: true,
            createPr: true,
          },
        },
      });
      actor.start();
      actor.send({ type: 'START' });
      await waitFor(actor, (s) => s.status === 'done', { timeout: 1000 });
      expect(actor.getSnapshot().value).toBe('complete');
      expect(detect).toHaveBeenCalledOnce();
      expect(actor.getSnapshot().context.completion?.changeDetection).toEqual(result);
      const post = emitted.mock.calls.filter(([name]) => name.startsWith('postinstall:'));
      expect(post).toEqual(
        result.state === 'changed'
          ? [['postinstall:changes', { files: result.files }]]
          : result.state === 'unchanged'
            ? [['postinstall:nochanges', {}]]
            : [
                [
                  'postinstall:unavailable',
                  { reason: result.state, ...(result.state === 'error' ? { error: result.error } : {}) },
                ],
              ],
      );
      actor.stop();
    },
  );
});
