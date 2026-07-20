// Single source of truth for compiling the standalone binary. Used by
// `bun run build` locally, ci.yml, and every release.yml matrix leg.
//
// WORKOS_BUILD_TARGET  bun compile target (e.g. bun-linux-x64-baseline);
//                      defaults to the host. Must match the target passed to
//                      `bun run generate` so the pinned Agent SDK matches.
// WORKOS_BUILD_OUTFILE output path; defaults to ./dist/workos.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const target = process.env.WORKOS_BUILD_TARGET;
const outfile = process.env.WORKOS_BUILD_OUTFILE ?? './dist/workos';

// Same musl detection the runtime's isMuslRuntime() and the napi-rs loaders use:
// Alpine's ldd is a musl script, and glibc processes report a glibcVersionRuntime
// header. Without this, a host build on Alpine would resolve the glibc keyring
// binding instead of the musl one the compiled binary needs.
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

// The keyring native binding for the compile target must be installed, or the
// compiled binary ships without OS keychain support and crashes at startup
// (config-store.ts imports @napi-rs/keyring statically). Fail the build fast
// instead — a missing binding means `bun install` ran without --os/--cpu
// wildcards for a cross-target build. `internal verify-assets` proves the
// binding actually loads at runtime on release smoke hardware.
const KEYRING_BINDINGS: Record<string, string> = {
  'darwin-arm64': '@napi-rs/keyring-darwin-arm64',
  'darwin-x64': '@napi-rs/keyring-darwin-x64',
  'linux-x64': '@napi-rs/keyring-linux-x64-gnu',
  'linux-arm64': '@napi-rs/keyring-linux-arm64-gnu',
  'linux-x64-musl': '@napi-rs/keyring-linux-x64-musl',
  'linux-arm64-musl': '@napi-rs/keyring-linux-arm64-musl',
  'windows-x64': '@napi-rs/keyring-win32-x64-msvc',
  'windows-arm64': '@napi-rs/keyring-win32-arm64-msvc',
};

const hostTarget = `bun-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}${
  isMuslHost() ? '-musl' : ''
}`;
const normalizedTarget = (target ?? hostTarget)
  .replace(/^bun-/, '')
  .replace(/-baseline$/, '')
  .replace(/-modern$/, '');
const keyringBinding = KEYRING_BINDINGS[normalizedTarget];
if (!keyringBinding) {
  throw new Error(`No keyring binding mapping for target ${normalizedTarget}; add it to KEYRING_BINDINGS`);
}
try {
  import.meta.resolve(`${keyringBinding}/package.json`);
} catch {
  throw new Error(
    `${keyringBinding} is not installed, so the ${normalizedTarget} binary would ship without OS keychain support. ` +
      `Run \`bun install --frozen-lockfile --os="*" --cpu="*"\` before cross-target builds.`,
  );
}

const args = [
  'build',
  '--compile',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  ...(target ? [`--target=${target}`] : []),
  './src/bin.ts',
  '--outfile',
  outfile,
];

const result = spawnSync('bun', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);
