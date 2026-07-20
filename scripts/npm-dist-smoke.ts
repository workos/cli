// End-to-end smoke test for the npm distribution channel: publishes the
// generated packages from dist/npm/ to a throwaway local registry (Verdaccio)
// and drives the exact flows users run — `npx workos`, `npm install -g workos`
// — from a hermetic environment (fresh HOME, cache, and npm prefix; sanitized
// PATH). This covers what the in-repo launcher check cannot: real registry
// fetch, optionalDependencies platform selection, npx cache + bin linking,
// and the launcher's no-binary error path.
//
// The registry has NO uplinks, so any fetch beyond our own packages fails
// loudly — proving the install is self-contained.
//
// Prerequisites: dist/npm/ generated (bun run build + gen-npm-packages.ts);
// if absent but dist/workos exists, this script generates a host-only set.
// Requires node/npm/npx on PATH. Skipped on Windows (CI covers unix).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (process.platform === 'win32') {
  console.log('npm-dist-smoke: skipped on Windows (covered by unix CI)');
  process.exit(0);
}

const projectRoot = join(import.meta.dirname, '..');
const npmDir = join(projectRoot, 'dist', 'npm');

function isMuslHost(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    if (readFileSync('/usr/bin/ldd', 'utf8').includes('musl')) return true;
  } catch {
    // No readable /usr/bin/ldd — fall through to the process report.
  }
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    if (report?.header) return !report.header.glibcVersionRuntime;
  } catch {
    // Report unavailable — assume glibc.
  }
  return false;
}

const hostKey = `${process.platform}-${process.arch}${isMuslHost() ? '-musl' : ''}`;
const hostAsset = `workos-${process.platform}-${process.arch}${isMuslHost() ? '-musl' : ''}`;

// Convenience for local runs: generate a host-only package set from the
// compiled binary when dist/npm is absent.
if (!existsSync(join(npmDir, 'workos'))) {
  const binary = join(projectRoot, 'dist', 'workos');
  if (!existsSync(binary)) {
    console.error('npm-dist-smoke: dist/workos not found — run `bun run build` first');
    process.exit(1);
  }
  copyFileSync(binary, join(projectRoot, 'dist', hostAsset));
  const gen = spawnSync('bun', ['run', join(projectRoot, 'scripts', 'gen-npm-packages.ts')], {
    stdio: 'inherit',
    env: { ...process.env, WORKOS_NPM_ALLOW_MISSING: '1' },
  });
  if (gen.status !== 0) process.exit(gen.status ?? 1);
}

const version = (JSON.parse(readFileSync(join(npmDir, 'workos', 'package.json'), 'utf8')) as { version: string })
  .version;
const platformPackageDirs = readdirSync(join(npmDir, '@workos')).map((name) => join(npmDir, '@workos', name));
if (!existsSync(join(npmDir, '@workos', `cli-${hostKey}`))) {
  console.error(`npm-dist-smoke: no package for this host (@workos/cli-${hostKey}) in dist/npm`);
  process.exit(1);
}

const root = mkdtempSync(join(tmpdir(), 'workos-npm-smoke-'));
const port = Number(process.env.WORKOS_SMOKE_REGISTRY_PORT) || 41000 + Math.floor(Math.random() * 8000);
const registry = `http://localhost:${port}`;
let verdaccio: ChildProcess | undefined;
let failed = false;

function check(label: string, ok: boolean, detail?: string): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed = true;
}

async function waitForRegistry(deadlineMs: number): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${registry}/-/ping`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

try {
  // A registry someone else is already running on this port would swallow our
  // publishes — require the port to be free before we start our own.
  if (await waitForRegistry(1)) {
    console.error(`npm-dist-smoke: something is already listening on ${registry}; set WORKOS_SMOKE_REGISTRY_PORT`);
    process.exit(1);
  }

  writeFileSync(
    join(root, 'verdaccio.yaml'),
    [
      `storage: ${join(root, 'storage')}`,
      'auth:',
      '  htpasswd:',
      `    file: ${join(root, 'htpasswd')}`,
      'packages:',
      "  'workos':",
      '    access: $all',
      '    publish: $authenticated',
      "  '@workos/*':",
      '    access: $all',
      '    publish: $authenticated',
      // No '**' rule and no uplinks: anything beyond our packages 404s.
      'max_body_size: 300mb',
      'log: { type: stdout, format: pretty, level: warn }',
    ].join('\n'),
  );

  verdaccio = spawn('bun', ['x', 'verdaccio@6', '--config', join(root, 'verdaccio.yaml'), '--listen', String(port)], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // First run may download verdaccio through bunx; allow for a cold cache.
  if (!(await waitForRegistry(120_000))) {
    console.error('npm-dist-smoke: local registry did not come up within 120s');
    process.exit(1);
  }

  const userResponse = await fetch(`${registry}/-/user/org.couchdb.user:smoke`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'smoke', password: 'smoke-test-password' }),
  });
  const { token } = (await userResponse.json()) as { token?: string };
  if (!token) {
    console.error('npm-dist-smoke: could not obtain a publish token from the local registry');
    process.exit(1);
  }
  const npmrc = join(root, 'npmrc');
  writeFileSync(npmrc, `//localhost:${port}/:_authToken=${token}\n`);

  // Platform packages before the launcher — same order as the release flow.
  for (const dir of [...platformPackageDirs, join(npmDir, 'workos')]) {
    const publish = spawnSync('npm', ['publish', '--registry', registry, '--access', 'public', '--userconfig', npmrc], {
      cwd: dir,
      encoding: 'utf8',
    });
    check(
      `publish ${dir.slice(npmDir.length + 1)}`,
      publish.status === 0,
      publish.status === 0 ? undefined : publish.stderr.trim().split('\n').at(-1),
    );
  }
  if (failed) process.exit(1);

  // Hermetic client environment. npx consults npm's global prefix bin and
  // PATH for an existing `workos` before fetching (a brew-installed workos
  // CLI hijacks it otherwise), so both are redirected to temp dirs that only
  // contain node/npm/npx.
  const home = join(root, 'home');
  const shimBin = join(root, 'shim-bin');
  mkdirSync(home, { recursive: true });
  mkdirSync(shimBin, { recursive: true });
  for (const tool of ['node', 'npm', 'npx']) {
    const found = Bun.which(tool);
    if (!found) {
      console.error(`npm-dist-smoke: ${tool} not found on PATH`);
      process.exit(1);
    }
    symlinkSync(found, join(shimBin, tool));
  }

  function clientEnv(prefix: string): Record<string, string> {
    return {
      PATH: `${shimBin}:/usr/bin:/bin`,
      HOME: home,
      TMPDIR: join(root, 'tmp'),
      npm_config_registry: registry,
      npm_config_cache: join(root, 'npm-cache'),
      npm_config_prefix: prefix,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      npm_config_update_notifier: 'false',
      WORKOS_TELEMETRY: 'false',
    };
  }

  mkdirSync(join(root, 'tmp'), { recursive: true });
  const npxPrefix = join(root, 'npx-prefix');
  mkdirSync(npxPrefix, { recursive: true });

  function run(args: string[], prefix: string): ReturnType<typeof spawnSync<string>> {
    return spawnSync(args[0], args.slice(1), { cwd: home, encoding: 'utf8', env: clientEnv(prefix) });
  }

  const bareNpx = run(['npx', '--yes', 'workos', '--version'], npxPrefix);
  check('npx workos --version', bareNpx.stdout.trim() === version, bareNpx.stdout.trim() || bareNpx.stderr.trim());

  const pinnedNpx = run(['npx', '--yes', `workos@${version}`, '--version'], npxPrefix);
  check(`npx workos@${version} --version`, pinnedNpx.stdout.trim() === version);

  const jsonRun = run(['npx', '--yes', 'workos', 'skills', 'list', '--json'], npxPrefix);
  let jsonOk = false;
  try {
    JSON.parse(jsonRun.stdout.trim());
    jsonOk = jsonRun.status === 0;
  } catch {
    // Not JSON — fails below.
  }
  check(
    'npx workos skills list --json emits valid JSON',
    jsonOk,
    jsonOk ? undefined : jsonRun.stderr.trim().slice(0, 200),
  );

  const globalPrefix = join(root, 'global-prefix');
  mkdirSync(globalPrefix, { recursive: true });
  const globalInstall = run(['npm', 'install', '-g', 'workos'], globalPrefix);
  check(
    'npm install -g workos',
    globalInstall.status === 0,
    globalInstall.status === 0 ? undefined : globalInstall.stderr.trim().split('\n').at(-1),
  );
  const globalRun = run([join(globalPrefix, 'bin', 'workos'), '--version'], globalPrefix);
  check('globally installed workos --version', globalRun.stdout.trim() === version);

  // npm nests a global package's deps inside it (lib/node_modules/workos/
  // node_modules/); newer versions may hoist to the prefix root — accept both.
  const globalScopeDirs = [
    join(globalPrefix, 'lib', 'node_modules', '@workos'),
    join(globalPrefix, 'lib', 'node_modules', 'workos', 'node_modules', '@workos'),
  ];
  const installedPlatformPackages = globalScopeDirs.flatMap((dir) => (existsSync(dir) ? readdirSync(dir) : []));
  check(
    `platform selection installed @workos/cli-${hostKey}`,
    installedPlatformPackages.includes(`cli-${hostKey}`),
    installedPlatformPackages.join(', ') || 'none installed',
  );
  if (installedPlatformPackages.length > 1) {
    // npm < 10.4 ignores the libc field and installs both linux flavors; the
    // launcher still picks the right one, so this is informational only.
    console.log(`  note: ${installedPlatformPackages.length} platform packages installed (old npm ignores libc)`);
  }

  // Simulate an unsupported platform deterministically: remove the installed
  // platform package(s) and rerun the launcher — it must fail with the
  // actionable "no prebuilt binary" message, not a raw resolution crash.
  for (const dir of globalScopeDirs) rmSync(dir, { recursive: true, force: true });
  const errorRun = run([join(globalPrefix, 'bin', 'workos'), '--version'], globalPrefix);
  check(
    'launcher fails helpfully when no platform binary is present',
    errorRun.status === 1 && /no prebuilt binary/.test(errorRun.stderr),
    `exit ${errorRun.status}`,
  );

  if (failed) process.exit(1);
  console.log(
    `\nnpm distribution smoke test passed: ${platformPackageDirs.length} platform package(s) + launcher v${version} (npx, pinned npx, JSON subcommand, global install, platform selection, no-binary error path)`,
  );
} finally {
  verdaccio?.kill();
  rmSync(root, { recursive: true, force: true });
}
