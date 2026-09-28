import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import {
  bootstrapFizzy,
  FIZZY_FIXTURE,
  fizzyEnvironment,
  preflightFizzy,
  prepareFizzyFixture,
} from './fizzy-fixture.js';
import { FixtureManager } from './fixture-manager.js';
import { execFileNoThrow } from '../../src/utils/exec-file.js';

vi.mock('../../src/utils/exec-file.js', () => ({ execFileNoThrow: vi.fn() }));
vi.mock('../fixtures/ruby/fizzy/fixture.json', async (original) => {
  const actual = await original<typeof import('../fixtures/ruby/fizzy/fixture.json')>();
  const { createHash } = await import('node:crypto');
  return {
    default: { ...actual.default, archiveSha256: createHash('sha256').update('synthetic archive').digest('hex') },
  };
});
// These must never be reached by offline preparation.
vi.mock('./env-loader.js', () => ({
  loadCredentials: () => {
    throw new Error('Credential access forbidden');
  },
}));
vi.mock('./agent-executor.js', () => ({
  AgentExecutor: class {
    constructor() {
      throw new Error('Paid executor forbidden');
    }
  },
}));

let root: string;
let target: string;
let archive: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'fizzy-offline-'));
  target = join(root, 'fixture');
  archive = join(root, 'source.tar.gz');
  await mkdir(target);
  await writeFile(archive, 'synthetic archive');
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden');
    }),
  );
  vi.mocked(execFileNoThrow)
    .mockReset()
    .mockImplementation(async (executable, args, options) => {
      if (executable === 'tar') {
        const app = options!.cwd!;
        await writeFile(join(app, '.ruby-version'), '3.4.8\n');
        await writeFile(join(app, 'LICENSE.md'), "O'Saasy synthetic notice");
        await mkdir(join(app, 'storage'));
        await mkdir(join(app, 'tmp'));
      }
      const stdout =
        executable === 'ruby'
          ? 'ruby 3.4.8 (synthetic)'
          : executable === 'bundle' && args[0] === '--version'
            ? 'Bundler version 4.0.18'
            : args[0] === 'rev-parse'
              ? 'synthetic-baseline'
              : '';
      return { status: 0, stdout, stderr: '' };
    });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

describe('isolated pinned preparation', () => {
  it('records immutable source, license, empty identity baseline and no patches', async () => {
    const app = await prepareFizzyFixture(target, archive);
    expect(app).toBe(join(target, 'app'));
    const record = JSON.parse(await readFile(join(target, 'artifacts/fixture.json'), 'utf8'));
    expect(record).toMatchObject({
      commit: '477c943e0506f109e5bc83ae9dadbe519732c045',
      license: "O'Saasy",
      ruby: '3.4.8',
      patches: [],
      baselineCommit: 'synthetic-baseline',
      bootstrapped: false,
    });
    expect(record.baselineIdentity).toContain('undecided');
    expect(execFileNoThrow).not.toHaveBeenCalledWith('bundle', expect.anything(), expect.anything());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on modified source and existing output without executing anything', async () => {
    await writeFile(archive, 'mutable main download');
    await expect(prepareFizzyFixture(target, archive)).rejects.toThrow('SHA-256');
    await writeFile(join(target, 'keep'), 'existing project');
    await expect(prepareFizzyFixture(target, archive)).rejects.toThrow('empty isolated');
    expect(execFileNoThrow).not.toHaveBeenCalled();
  });

  it('isolates inherited credentials, home, dependency caches and database configuration', () => {
    for (const key of [
      'WORKOS_API_KEY',
      'ANTHROPIC_API_KEY',
      'DATABASE_URL',
      'SAAS',
      'BUNDLE_GEMFILE',
      'RUBYOPT',
      'GIT_CONFIG_COUNT',
    ])
      vi.stubEnv(key, 'must-not-inherit');
    const env = fizzyEnvironment(target);
    expect(env.HOME).toBe(join(target, 'home'));
    expect(env.BUNDLE_PATH).toBe(join(target, 'dependencies'));
    expect(env.BUNDLE_GEMFILE).toBe(join(target, 'app/Gemfile'));
    expect(env.RAILS_ENV).toBe('test');
    expect(Object.values(env)).not.toContain('must-not-inherit');
    expect(env).not.toHaveProperty('SAAS');
  });

  it('preflight only probes runtime versions and never claims acceptance', async () => {
    vi.mocked(execFileNoThrow).mockResolvedValue({ status: 0, stdout: 'ruby 4.0.7', stderr: '' });
    const result = await preflightFizzy(target);
    expect(result.runtimeAvailable).toBe(false);
    expect(result.acceptance).toBe('unverified');
    expect(execFileNoThrow).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('bootstraps only fresh test schema, never upstream scripts or seeds/reset', async () => {
    await prepareFizzyFixture(target, archive);
    await bootstrapFizzy(target);
    expect(execFileNoThrow).toHaveBeenCalledWith(
      'bundle',
      ['exec', 'rails', 'db:prepare'],
      expect.objectContaining({ env: expect.objectContaining({ RAILS_ENV: 'test' }) }),
    );
    const calls = JSON.stringify(vi.mocked(execFileNoThrow).mock.calls);
    for (const forbidden of ['bin/setup', 'db:reset', 'db:seed', 'Gemfile.saas'])
      expect(calls).not.toContain(forbidden);
    await expect(bootstrapFizzy(target)).rejects.toThrow('fresh pinned fixture');
  });

  it.each(['storage/test.sqlite3', 'tmp/saas.txt'])('refuses bootstrap with %s', async (file) => {
    await prepareFizzyFixture(target, archive);
    await writeFile(join(target, 'app', file), 'preserve');
    await expect(bootstrapFizzy(target)).rejects.toThrow('existing database or SaaS');
  });

  it('requires explicit opt-in in FixtureManager before any execution', async () => {
    vi.stubEnv('FIZZY_APPROVED_RUN', '');
    const manager = new FixtureManager('ruby', 'fizzy');
    await expect(manager.setup()).rejects.toThrow('explicit spending/policy approval');
    await manager.cleanup();
    expect(manager.getTempDir()).toBeNull();
    expect(execFileNoThrow).not.toHaveBeenCalled();
  });

  it('cleans up a failed manager preparation without touching its input archive', async () => {
    vi.stubEnv('FIZZY_APPROVED_RUN', '1');
    vi.stubEnv('FIZZY_ARCHIVE', archive);
    await writeFile(archive, 'wrong pin');
    const manager = new FixtureManager('ruby', 'fizzy');
    await expect(manager.setup()).rejects.toThrow('SHA-256');
    const attempt = manager.getTempDir()!;
    expect(attempt).toContain('.artifacts/fizzy-evals/attempt-');
    await manager.cleanup();
    await expect(readFile(join(attempt, 'source.tar.gz'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(archive, 'utf8')).toBe('wrong pin');
    expect(manager.getTempDir()).toBeNull();
  });

  it('descriptor pin matches the inspected public archive checksum', async () => {
    const real = JSON.parse(await readFile(join(process.cwd(), 'tests/fixtures/ruby/fizzy/fixture.json'), 'utf8'));
    expect(real.archiveUrl).toContain(real.commit);
    expect(real.archiveSha256).toBe('4cfc52d62d082f304a946dcf02d6097886100f1430eb502daf503e9f2439a628');
    expect(FIZZY_FIXTURE.archiveSha256).toBe(createHash('sha256').update('synthetic archive').digest('hex'));
  });
});
