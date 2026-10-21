import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execFileNoThrow } from './exec-file.js';
import { IS_WINDOWS } from './platform.js';

let root: string;
let project: string;
let tools: string;
let originalCwd: string;
let env: NodeJS.ProcessEnv;

async function tool(directory: string, name: string, body: string): Promise<void> {
  await writeFile(
    join(directory, `${name}${IS_WINDOWS ? '.cmd' : ''}`),
    `${IS_WINDOWS ? '@echo off\r\n' : '#!/bin/sh\n'}${body}\n`,
    { mode: 0o755 },
  );
}

beforeEach(async () => {
  originalCwd = process.cwd();
  root = await mkdtemp(join(tmpdir(), 'exec-file-test-'));
  project = join(root, 'untrusted project');
  tools = join(root, 'installed tools');
  await mkdir(project);
  await mkdir(tools);
  // Windows searches CWD implicitly. On POSIX, a relative PATH entry gives
  // us the same regression signal without mocking spawn or the platform.
  env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')),
    PATH: `${IS_WINDOWS ? '' : `.${delimiter}`}${tools}`,
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    EXEC_TEST_MARKER: join(root, 'planted-ran'),
  };
  process.chdir(project);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  process.chdir(originalCwd);
  await rm(root, { recursive: true, force: true });
});

describe('execFileNoThrow', () => {
  it.each(['node', 'npm', 'bun', 'claude', 'codex'])('does not execute a repo-local %s shim', async (name) => {
    await tool(tools, name, 'echo trusted');
    await tool(
      project,
      name,
      IS_WINDOWS
        ? 'echo planted> "%EXEC_TEST_MARKER%"\r\necho untrusted'
        : 'echo planted > "$EXEC_TEST_MARKER"\necho untrusted',
    );

    const result = await execFileNoThrow(name, ['--version'], { env });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toBe('trusted');
    await expect(access(env.EXEC_TEST_MARKER!)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(process.cwd()).toBe(await realpath(project));
  });

  it('uses a fresh directory per call and removes it after the process closes', async () => {
    await tool(tools, 'probe', IS_WINDOWS ? 'cd' : 'pwd');
    const first = await execFileNoThrow('probe', [], { env });
    const second = await execFileNoThrow('probe', [], { env });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(first.stdout.trim()).not.toBe(second.stdout.trim());
    for (const result of [first, second]) {
      await expect(access(result.stdout.trim())).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });

  it('preserves an explicit working directory for trusted project commands', async () => {
    await writeFile(join(project, 'input.txt'), 'project input\n');
    await tool(
      tools,
      'probe',
      IS_WINDOWS ? 'type input.txt' : 'while IFS= read -r line; do echo "$line"; done < input.txt',
    );

    const result = await execFileNoThrow('probe', [], { cwd: project, env });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('project input');
    expect(await readFile(join(project, 'input.txt'), 'utf8')).toBe('project input\n');
  });

  it('captures nonzero exits and cleans up the working directory', async () => {
    await tool(tools, 'probe', IS_WINDOWS ? 'cd\r\necho failure 1>&2\r\nexit /b 7' : 'pwd\necho failure >&2\nexit 7');

    const result = await execFileNoThrow('probe', [], { env });

    expect(result.status).toBe(7);
    expect(result.stderr.trim()).toBe('failure');
    await expect(access(result.stdout.trim())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not fall back to a repo-local shim when the tool is missing from PATH', async () => {
    await tool(project, 'workos-nonexistent-test-tool', 'echo untrusted');
    const result = await execFileNoThrow('workos-nonexistent-test-tool', [], { env });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toBe('');
  });

  it('fails closed when it cannot create the isolated directory', async () => {
    await tool(tools, 'probe', 'echo ran');
    for (const key of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(key, join(root, 'missing'));

    const result = await execFileNoThrow('probe', [], { env });

    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('ENOENT');
  });

  it('cleans up after a timed-out process', async () => {
    // Shell builtins only, so there is no surviving grandchild holding pipes.
    await tool(tools, 'probe', IS_WINDOWS ? 'cd\r\n:loop\r\ngoto loop' : 'pwd\nwhile :; do :; done');

    const result = await execFileNoThrow('probe', [], { env, timeout: 500 });

    expect(result.status).not.toBe(0);
    expect(result.stdout.trim()).not.toBe('');
    await expect(access(result.stdout.trim())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
