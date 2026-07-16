// Generates the npm distribution packages into dist/npm/ from already-built
// platform binaries in dist/ (release asset names). Layout follows the
// esbuild/swc/clerk thin-shim pattern:
//
//   dist/npm/workos                     thin Node launcher; optionalDependencies
//                                       pull in exactly one platform package
//   dist/npm/@workos/cli-<os>-<arch>    the compiled binary for one platform
//
// WORKOS_NPM_VERSION        version to stamp on every package; defaults to the
//                           repo package.json version.
// WORKOS_NPM_ALLOW_MISSING  set to 1 to generate packages only for the
//                           binaries present in dist/ (local testing; the
//                           launcher's optionalDependencies are pruned to
//                           match). Release runs must not set this.
import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const projectRoot = join(import.meta.dirname, '..');
const distDir = join(projectRoot, 'dist');
const outDir = join(distDir, 'npm');
const allowMissing = process.env.WORKOS_NPM_ALLOW_MISSING === '1';

const rootPackageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
};
const version = process.env.WORKOS_NPM_VERSION ?? rootPackageJson.version;
if (!/^\d+\.\d+\.\d+(-.+)?$/.test(version)) {
  throw new Error(`Invalid npm version: ${version}`);
}

const REPOSITORY = { type: 'git', url: 'git+https://github.com/workos/cli.git' };
const LICENSE = 'MIT';

// Platform keys use process.platform/process.arch values so the launcher can
// build the package name from the running process; assets use release names.
const PLATFORMS = [
  { key: 'darwin-arm64', os: 'darwin', cpu: 'arm64', asset: 'workos-darwin-arm64', bin: 'workos' },
  { key: 'darwin-x64', os: 'darwin', cpu: 'x64', asset: 'workos-darwin-x64', bin: 'workos' },
  { key: 'linux-x64', os: 'linux', cpu: 'x64', asset: 'workos-linux-x64', bin: 'workos' },
  { key: 'linux-arm64', os: 'linux', cpu: 'arm64', asset: 'workos-linux-arm64', bin: 'workos' },
  { key: 'win32-x64', os: 'win32', cpu: 'x64', asset: 'workos-windows-x64.exe', bin: 'workos.exe' },
];

const present = PLATFORMS.filter((platform) => existsSync(join(distDir, platform.asset)));
const missing = PLATFORMS.filter((platform) => !present.includes(platform));
if (missing.length > 0 && !allowMissing) {
  throw new Error(`Missing platform binaries in dist/: ${missing.map((p) => p.asset).join(', ')}`);
}
if (present.length === 0) {
  throw new Error('No platform binaries found in dist/');
}

rmSync(outDir, { recursive: true, force: true });

const LAUNCHER = `#!/usr/bin/env node
'use strict';
// Thin launcher: resolves the compiled workos binary for this platform from
// the matching @workos/cli-<platform>-<arch> optionalDependency and runs it.
const { spawnSync } = require('node:child_process');

const key = \`\${process.platform}-\${process.arch}\`;
const executable = process.platform === 'win32' ? 'workos.exe' : 'workos';

let binary;
try {
  binary = require.resolve(\`@workos/cli-\${key}/bin/\${executable}\`);
} catch {
  console.error(\`workos: no prebuilt binary for \${key}.\`);
  console.error('Supported platforms: ${PLATFORMS.map((p) => p.key).join(', ')}.');
  console.error('If your platform is listed, reinstall with optional dependencies enabled');
  console.error('(npm install --include=optional), or download a binary directly:');
  console.error('https://github.com/workos/cli/releases/latest');
  process.exit(1);
}

const result = spawnSync(binary, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) {
  console.error(\`workos: failed to run \${binary}: \${result.error.message}\`);
  process.exit(1);
}
if (result.signal) {
  process.kill(process.pid, result.signal);
}
process.exit(result.status ?? 1);
`;

for (const platform of present) {
  const packageDir = join(outDir, '@workos', `cli-${platform.key}`);
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  await writeFile(
    join(packageDir, 'package.json'),
    `${JSON.stringify(
      {
        name: `@workos/cli-${platform.key}`,
        version,
        description: `WorkOS CLI binary for ${platform.key}`,
        repository: REPOSITORY,
        license: LICENSE,
        os: [platform.os],
        cpu: [platform.cpu],
        files: ['bin'],
      },
      null,
      2,
    )}\n`,
  );
  const binPath = join(packageDir, 'bin', platform.bin);
  copyFileSync(join(distDir, platform.asset), binPath);
  chmodSync(binPath, 0o755);
}

const launcherDir = join(outDir, 'workos');
mkdirSync(join(launcherDir, 'bin'), { recursive: true });
await writeFile(
  join(launcherDir, 'package.json'),
  `${JSON.stringify(
    {
      name: 'workos',
      version,
      description: rootPackageJson.description ?? 'WorkOS CLI',
      repository: REPOSITORY,
      license: LICENSE,
      homepage: rootPackageJson.homepage ?? 'https://github.com/workos/cli',
      bin: { workos: 'bin/workos.js' },
      files: ['bin'],
      engines: { node: '>=18' },
      optionalDependencies: Object.fromEntries(present.map((p) => [`@workos/cli-${p.key}`, version])),
    },
    null,
    2,
  )}\n`,
);
await writeFile(join(launcherDir, 'bin', 'workos.js'), LAUNCHER);
chmodSync(join(launcherDir, 'bin', 'workos.js'), 0o755);
await writeFile(
  join(launcherDir, 'README.md'),
  [
    '# workos',
    '',
    'Thin npm launcher for the WorkOS CLI. Installing this package pulls in the',
    'prebuilt binary for your platform via an optional dependency and runs it.',
    '',
    'Standalone binaries are also available from',
    '[GitHub Releases](https://github.com/workos/cli/releases/latest).',
    '',
  ].join('\n'),
);

console.log(`Generated npm packages (v${version}) in ${outDir}:`);
console.log(`  workos (launcher, ${present.length} optional platform deps)`);
for (const platform of present) {
  console.log(`  @workos/cli-${platform.key}`);
}
if (missing.length > 0) {
  console.log(`Skipped missing binaries: ${missing.map((p) => p.asset).join(', ')}`);
}
