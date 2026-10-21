import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentExecutor } from '../agent-executor.js';
import { runAgent } from '../../../src/lib/agent-interface.js';
import { execFileNoThrow } from '../../../src/utils/exec-file.js';
import { collectKeyFiles } from '../graders/collect-key-files.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

const secrets = vi.hoisted(() => ({
  workosApiKey: 'sk_test_SYNTHETIC_EVAL_SECRET',
  workosClientId: 'client_SYNTHETIC',
  anthropicApiKey: 'sk-ant-SYNTHETIC_EVAL_SECRET',
}));
vi.mock('../env-loader.js', () => ({ loadCredentials: vi.fn(() => secrets) }));
vi.mock('../../../src/lib/agent-interface.js', () => ({ runAgent: vi.fn(async () => ({})) }));
vi.mock('../../../src/lib/agent-sdk-assets.js', () => ({
  ensureClaudeCodeExecutable: vi.fn(async () => '/synthetic/claude'),
}));
vi.mock('../../../src/lib/validation/quick-checks.js', () => ({ quickCheckValidateAndFormat: vi.fn() }));

let root: string;
let app: string;
let environment: NodeJS.ProcessEnv;
async function git(...args: string[]) {
  const result = await execFileNoThrow('git', args, { cwd: app, env: environment });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(runAgent).mockReset().mockResolvedValue({});
  await mkdir('.artifacts', { recursive: true });
  root = await mkdtemp(join(process.cwd(), '.artifacts/eval-secret-test-'));
  app = join(root, 'app');
  await mkdir(app);
  await mkdir(join(root, 'home'));
  environment = {
    PATH: process.env.PATH,
    HOME: join(root, 'home'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Synthetic fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden');
    }),
  );
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await git('init');
  await writeFile(join(app, 'Gemfile'), 'source "https://rubygems.org"\ngem "rails"\n');
  await git('add', '-A');
  await git('-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-m', 'synthetic baseline');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(root, { recursive: true, force: true });
});

it.each(['ruby', 'python', 'go', 'php', 'php-laravel', 'kotlin', 'dotnet', 'elixir'])(
  'protects %s .env from status, diff, staging, output and collected artifacts',
  async (framework) => {
    const ignore = '# Preserve unrelated rules\n/vendor\n/cache';
    await writeFile(join(app, '.gitignore'), ignore);
    // A non-JS fixture can also have frontend tooling; it still needs .env, not .env.local.
    await writeFile(join(app, 'package.json'), '{"private":true}\n');
    await git('add', '-A');
    await git('-c', 'core.hooksPath=/dev/null', 'commit', '--no-gpg-sign', '-m', 'fixture ignores');
    vi.mocked(runAgent).mockImplementation(async (...args) => {
      // Exercise the leak path: ordinary agent Git inspection/staging enters its transcript.
      const status = await git('status', '--porcelain', '--untracked-files=all');
      await git('add', '-A');
      const diff = await git('diff', '--cached');
      args[6]?.({
        type: 'assistant',
        message: { content: [{ type: 'text', text: `${status}\n${diff}` }] },
      } as SDKMessage);
      return {};
    });
    const result = await new AgentExecutor(app, framework, { environment, verbose: true }).run({
      enabled: false,
      maxRetries: 0,
    });
    const env = await readFile(join(app, '.env'), 'utf8');
    expect(env).toContain(`WORKOS_API_KEY=${secrets.workosApiKey}`);
    expect(env).toContain(`WORKOS_CLIENT_ID=${secrets.workosClientId}`);
    if (process.platform !== 'win32') expect((await stat(join(app, '.env'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(app, '.gitignore'), 'utf8')).toContain(ignore);
    expect(await git('check-ignore', '.env')).toBe('.env\n');
    expect(await git('status', '--porcelain', '--untracked-files=all')).not.toMatch(/(?:\?\?| M|A ) \.env\n/);
    await git('add', '-A');
    expect(await git('ls-files', '--', '.env')).toBe('');
    const diff = await git('diff', 'HEAD');
    const stagedDiff = await git('diff', '--cached');
    const files = await collectKeyFiles(app, framework);
    const artifact = JSON.stringify({ result, keyFiles: Object.fromEntries(files), diff, stagedDiff });
    await writeFile(join(root, 'result.json'), artifact);
    const prompt = vi.mocked(runAgent).mock.calls[0][1];
    const logs = JSON.stringify([
      vi.mocked(console.log).mock.calls,
      vi.mocked(console.warn).mock.calls,
      vi.mocked(console.error).mock.calls,
    ]);
    // Assert raw content, not redacted/filtered copies. Secrets are present only in the protected env file.
    for (const secret of Object.values(secrets)) {
      expect(prompt).not.toContain(secret);
      expect(logs).not.toContain(secret);
      expect(await readFile(join(root, 'result.json'), 'utf8')).not.toContain(secret);
    }
    expect(fetch).not.toHaveBeenCalled();
  },
);

it('protects an existing .env and its backup despite earlier ignore rules followed by negations', async () => {
  const original = '# existing config\nOTHER=keep\nWORKOS_API_KEY=sk_test_SYNTHETIC_OLD\n';
  const ignore = '.env*\n!.env\n!.env.bak\n';
  await writeFile(join(app, '.gitignore'), ignore);
  await writeFile(join(app, '.env'), original, { mode: 0o644 });
  await new AgentExecutor(app, 'ruby', { environment }).run();
  expect(await readFile(join(app, '.env.bak'), 'utf8')).toBe(original);
  expect(await readFile(join(app, '.env'), 'utf8')).toContain('OTHER=keep');
  expect(await readFile(join(app, '.gitignore'), 'utf8')).toContain(ignore);
  for (const path of ['.env', '.env.bak']) {
    if (process.platform !== 'win32') expect((await stat(join(app, path))).mode & 0o777).toBe(0o600);
    expect(await git('check-ignore', path)).toBe(`${path}\n`);
  }
  await git('add', '-A');
  expect(await git('ls-files', '--', '.env', '.env.bak')).toBe('');
  expect(await git('diff', '--cached')).not.toContain('sk_test_SYNTHETIC');
});

it('fails before writing credentials or starting an agent when ignore protection cannot be installed', async () => {
  await mkdir(join(app, '.gitignore'));
  await expect(new AgentExecutor(app, 'ruby', { environment }).run()).rejects.toThrow();
  await expect(readFile(join(app, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(runAgent).not.toHaveBeenCalled();
});

it.skipIf(process.platform === 'win32')(
  'refuses credential symlinks without reading or changing their targets',
  async () => {
    const target = join(root, 'unrelated.env');
    await writeFile(target, 'UNRELATED=untouched\n', { mode: 0o644 });
    await symlink(target, join(app, '.env'));
    await expect(new AgentExecutor(app, 'ruby', { environment }).run()).rejects.toThrow('non-regular');
    expect(await readFile(target, 'utf8')).toBe('UNRELATED=untouched\n');
    expect((await stat(target)).mode & 0o777).toBe(0o644);
    expect(runAgent).not.toHaveBeenCalled();
  },
);

it('refuses credentials when Git protection cannot be checked', async () => {
  await rm(join(app, '.git'), { recursive: true, force: true });
  // Prevent Git from walking up into the CLI worktree containing the test artifact.
  environment.GIT_CEILING_DIRECTORIES = root;
  await expect(new AgentExecutor(app, 'ruby', { environment }).run()).rejects.toThrow('Git fixture');
  await expect(readFile(join(app, '.env'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(runAgent).not.toHaveBeenCalled();
});

it.each(['.env', '.env.bak'])('refuses a tracked %s rather than relying on ineffective ignore rules', async (path) => {
  await writeFile(join(app, path), 'INNOCUOUS_TEMPLATE=1\n');
  await git('add', path);
  await expect(new AgentExecutor(app, 'ruby', { environment }).run()).rejects.toThrow('tracked');
  expect(await readFile(join(app, path), 'utf8')).toBe('INNOCUOUS_TEMPLATE=1\n');
  expect(runAgent).not.toHaveBeenCalled();
});
