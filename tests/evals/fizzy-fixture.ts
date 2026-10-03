import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileNoThrow } from '../../src/utils/exec-file.js';
import fixture from '../fixtures/ruby/fizzy/fixture.json';

export { fixture as FIZZY_FIXTURE };

/** Deliberately allowlisted: no developer credentials, SaaS flags, database URLs or home config. */
export function fizzyEnvironment(root: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: join(root, 'home'),
    XDG_CONFIG_HOME: join(root, 'home/config'),
    XDG_CACHE_HOME: join(root, 'cache'),
    TMPDIR: join(root, 'tmp'),
    BUNDLE_USER_HOME: join(root, 'home/bundle'),
    BUNDLE_APP_CONFIG: join(root, 'bundle-config'),
    BUNDLE_PATH: join(root, 'dependencies'),
    BUNDLE_GEMFILE: join(root, 'app/Gemfile'),
    BUNDLE_FROZEN: 'true',
    GEM_HOME: join(root, 'gems'),
    MISE_DATA_DIR: join(root, 'mise/data'),
    MISE_CONFIG_DIR: join(root, 'mise/config'),
    MISE_CACHE_DIR: join(root, 'mise/cache'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    RAILS_ENV: 'test',
    DATABASE_ADAPTER: 'sqlite',
    DISABLE_SPRING: '1',
    CI: '1',
    PORT: '3006',
    SECRET_KEY_BASE: 'synthetic-fixture-only-not-for-deployment'.repeat(3),
  };
}

async function command(root: string, executable: string, args: string[], cwd = join(root, 'app')) {
  const result = await execFileNoThrow(executable, args, { cwd, env: fizzyEnvironment(root), timeout: 600_000 });
  if (result.status !== 0) throw new Error(`${executable} ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

/** No network and no scripts from the downloaded app. Only accepts the immutable, hashed archive. */
export async function prepareFizzyFixture(root: string, archive: string): Promise<string> {
  root = resolve(root);
  if ((await readdir(root)).length) throw new Error('Fizzy preparation requires an empty isolated directory');
  const bytes = await readFile(archive);
  if (createHash('sha256').update(bytes).digest('hex') !== fixture.archiveSha256) {
    throw new Error('Fizzy archive SHA-256 mismatch');
  }
  for (const dir of ['app', 'home', 'home/config', 'cache', 'tmp', 'artifacts', 'gems']) {
    await mkdir(join(root, dir), { recursive: true });
  }
  // Extract the bytes we verified, not a caller-owned path that could change between hash and extraction.
  await writeFile(join(root, 'source.tar.gz'), bytes);
  await command(root, 'tar', ['-xzf', join(root, 'source.tar.gz'), '--strip-components=1']);
  const app = join(root, 'app');
  if ((await readFile(join(app, '.ruby-version'), 'utf8')).trim() !== fixture.ruby) {
    throw new Error('Unexpected Fizzy Ruby version');
  }
  if (!(await readFile(join(app, fixture.licenseFile), 'utf8')).includes("O'Saasy")) {
    throw new Error('Fizzy license notice missing');
  }
  await command(root, 'git', ['init']);
  await command(root, 'git', ['add', '-A']);
  await command(root, 'git', [
    '-c',
    'user.name=Fixture Baseline',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--no-gpg-sign',
    '-m',
    `Fizzy baseline ${fixture.commit}`,
  ]);
  const baselineCommit = await command(root, 'git', ['rev-parse', 'HEAD']);
  await writeFile(
    join(root, 'artifacts/fixture.json'),
    JSON.stringify({ ...fixture, baselineCommit, prepared: true, bootstrapped: false }, null, 2),
  );
  return app;
}

/** Probe tool versions only; never construct AgentExecutor or read eval credentials. */
export async function preflightFizzy(root: string) {
  const checks: { name: string; available: boolean; detail: string }[] = [];
  for (const [executable, args, expected] of [
    ['ruby', ['--version'], `ruby ${fixture.ruby} `],
    ['bundle', ['--version'], fixture.bundler],
  ] as const) {
    const result = await execFileNoThrow(executable, [...args], {
      cwd: root,
      env: fizzyEnvironment(root),
      timeout: 10_000,
    });
    checks.push({
      name: executable,
      available: result.status === 0 && result.stdout.includes(expected),
      detail: result.stdout.trim() || result.stderr.trim(),
    });
  }
  const runtimeAvailable = checks.every((check) => check.available);
  let prepared = false;
  try {
    const metadata = JSON.parse(await readFile(join(root, 'artifacts/fixture.json'), 'utf8'));
    const archive = await readFile(join(root, 'source.tar.gz'));
    prepared =
      metadata.commit === fixture.commit &&
      createHash('sha256').update(archive).digest('hex') === fixture.archiveSha256;
  } catch {
    // Missing preparation is an unavailable prerequisite, not a successful check.
  }
  checks.push({
    name: 'pinned source archive',
    available: prepared,
    detail: prepared ? fixture.commit : 'Missing or mismatched prepared archive/metadata',
  });
  return {
    fixture: fixture.commit,
    checks,
    prepared,
    runtimeAvailable,
    acceptance: 'unverified',
    blockers: [
      'Account-linking/membership/creation/coexistence policy requires approval',
      'No route/session/browser or hosted AuthKit evidence collected',
    ],
  };
}

/** Opt-in dependency install/test schema only, never upstream bin/setup, db:reset, or SaaS. */
export async function bootstrapFizzy(root: string): Promise<void> {
  root = resolve(root);
  const metadata = JSON.parse(await readFile(join(root, 'artifacts/fixture.json'), 'utf8'));
  if (metadata.commit !== fixture.commit || metadata.bootstrapped) throw new Error('Not a fresh pinned fixture');
  const app = join(root, 'app');
  const tracked = await command(root, 'git', ['status', '--porcelain', '--untracked-files=all']);
  if (tracked) throw new Error('Bootstrap requires an unchanged baseline');
  for (const directory of ['storage', 'tmp']) {
    const entries = await readdir(join(app, directory), { recursive: true });
    if (entries.some((entry) => /(?:\.sqlite3(?:-|$)|saas\.txt$)/.test(entry))) {
      throw new Error('Refusing an existing database or SaaS marker');
    }
  }
  const preflight = await preflightFizzy(root);
  if (!preflight.prepared || !preflight.runtimeAvailable)
    throw new Error('Fizzy source/runtime prerequisites unavailable');
  await command(root, 'bundle', ['install']);
  await command(root, 'bundle', ['exec', 'rails', 'db:prepare']);
  await writeFile(
    join(root, 'artifacts/fixture.json'),
    JSON.stringify({ ...metadata, bootstrapped: true, databaseEnvironment: 'test' }, null, 2),
  );
}
