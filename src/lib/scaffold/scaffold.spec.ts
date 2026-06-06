import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the spawn used by runCreateNextApp. Hoisted by vitest.
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
import { spawn } from 'node:child_process';

import {
  CREATE_NEXT_APP_VERSION,
  SAFE_EMPTY_FILES,
  buildCreateNextAppArgs,
  isScaffoldableEmptyDir,
  resolvePackageManager,
  runCreateNextApp,
  type PackageManager,
} from './scaffold.js';
import { InstallerEventEmitter } from '../events.js';

describe('isScaffoldableEmptyDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'workos-scaffold-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function write(name: string, content = ''): void {
    writeFileSync(join(dir, name), content);
  }

  it('returns true for a truly empty directory', async () => {
    expect(await isScaffoldableEmptyDir(dir)).toBe(true);
  });

  it('returns true when only safe files are present (.git + .gitignore)', async () => {
    mkdirSync(join(dir, '.git'));
    write('.gitignore', 'node_modules');
    write('LICENSE', 'MIT');
    expect(await isScaffoldableEmptyDir(dir)).toBe(true);
  });

  it('returns false when a package.json is present', async () => {
    write('package.json', '{}');
    expect(await isScaffoldableEmptyDir(dir)).toBe(false);
  });

  it('returns false when an unrelated stray file is present', async () => {
    mkdirSync(join(dir, '.git'));
    write('notes.txt', 'hello');
    expect(await isScaffoldableEmptyDir(dir)).toBe(false);
  });

  it('returns false for a non-JS manifest (go.mod)', async () => {
    write('go.mod', 'module example.com/app');
    expect(await isScaffoldableEmptyDir(dir)).toBe(false);
  });

  it('SAFE_EMPTY_FILES excludes README.md (not in create-next-app validFiles)', () => {
    expect(SAFE_EMPTY_FILES.has('README.md')).toBe(false);
    expect(SAFE_EMPTY_FILES.has('.vscode')).toBe(false);
  });
});

describe('resolvePackageManager', () => {
  it('parses pnpm from the user agent', () => {
    expect(resolvePackageManager({ userAgent: 'pnpm/8.6.0 npm/? node/v20.0.0 darwin arm64' })).toBe('pnpm');
  });

  it('parses bun from the user agent', () => {
    expect(resolvePackageManager({ userAgent: 'bun/1.1.0 npm/? node/v20' })).toBe('bun');
  });

  it('parses yarn from the user agent', () => {
    expect(resolvePackageManager({ userAgent: 'yarn/4.0.0 npm/? node/v20' })).toBe('yarn');
  });

  it('falls back to npm when the user agent is absent', () => {
    expect(resolvePackageManager({})).toBe('npm');
  });

  it('falls back to npm for an unrecognized user agent', () => {
    expect(resolvePackageManager({ userAgent: 'cnpm/1.0.0 node/v20' })).toBe('npm');
  });

  it('lets a valid --pm override beat the user agent', () => {
    expect(resolvePackageManager({ pm: 'pnpm', userAgent: 'npm/10.0.0 node/v20' })).toBe('pnpm');
  });

  it('ignores an invalid --pm and falls through to the user agent', () => {
    expect(resolvePackageManager({ pm: 'cargo', userAgent: 'pnpm/8 npm/? node/v20' })).toBe('pnpm');
  });

  it('ignores an invalid --pm and falls back to npm with no user agent', () => {
    expect(resolvePackageManager({ pm: 'cargo' })).toBe('npm');
  });
});

describe('buildCreateNextAppArgs', () => {
  it('produces the exact pinned arg array for pnpm', () => {
    expect(buildCreateNextAppArgs('pnpm')).toEqual([
      '.',
      '--ts',
      '--app',
      '--eslint',
      '--tailwind',
      '--src-dir',
      '--import-alias',
      '@/*',
      '--use-pnpm',
      '--yes',
    ]);
  });

  it('ends with --use-<pm> for each package manager', () => {
    const managers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
    for (const pm of managers) {
      const args = buildCreateNextAppArgs(pm);
      expect(args.at(-1)).toBe('--yes');
      expect(args).toContain(`--use-${pm}`);
      // App shape stays constant regardless of PM.
      expect(args).toEqual(expect.arrayContaining(['--ts', '--app', '--tailwind', '--src-dir']));
    }
  });

  it('does not pass a turbopack flag (relies on --yes defaults)', () => {
    const args = buildCreateNextAppArgs('npm');
    expect(args).not.toContain('--turbopack');
    expect(args).not.toContain('--no-turbopack');
  });
});

describe('runCreateNextApp', () => {
  function makeFakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  }

  beforeEach(() => {
    (spawn as unknown as Mock).mockReset();
  });

  it('spawns npx with the pinned create-next-app version and cwd, streaming progress', async () => {
    const child = makeFakeChild();
    (spawn as unknown as Mock).mockReturnValue(child);

    const emitter = new InstallerEventEmitter();
    const progress: string[] = [];
    emitter.on('scaffold:progress', (p) => progress.push(p.text));

    const promise = runCreateNextApp({ installDir: '/tmp/wos-empty', packageManager: 'pnpm', emitter });

    child.stdout.emit('data', Buffer.from('Creating a new Next.js app...'));
    child.emit('close', 0);

    await expect(promise).resolves.toBeUndefined();
    expect(progress.join('')).toContain('Creating a new Next.js app');
    expect(spawn).toHaveBeenCalledWith(
      'npx',
      expect.arrayContaining([`create-next-app@${CREATE_NEXT_APP_VERSION}`, '--use-pnpm']),
      expect.objectContaining({ cwd: '/tmp/wos-empty' }),
    );
  });

  it('rejects when create-next-app exits non-zero, preserving stderr', async () => {
    const child = makeFakeChild();
    (spawn as unknown as Mock).mockReturnValue(child);

    const emitter = new InstallerEventEmitter();
    const promise = runCreateNextApp({ installDir: '/tmp/wos-empty', packageManager: 'npm', emitter });

    child.stderr.emit('data', Buffer.from('network error'));
    child.emit('close', 1);

    await expect(promise).rejects.toThrow(/exited with code 1.*network error/s);
  });

  it('rejects on spawn error', async () => {
    const child = makeFakeChild();
    (spawn as unknown as Mock).mockReturnValue(child);

    const emitter = new InstallerEventEmitter();
    const promise = runCreateNextApp({ installDir: '/tmp/wos-empty', packageManager: 'npm', emitter });

    child.emit('error', new Error('spawn npx ENOENT'));

    await expect(promise).rejects.toThrow(/ENOENT/);
  });
});
