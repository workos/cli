import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { SPAWN_OPTS } from '../../utils/platform.js';
import type { InstallerEventEmitter } from '../events.js';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * The `create-next-app` major we pin to. Matches `authkit-nextjs/examples/next`
 * (Next 16). A major float (`@16`) keeps the pinned flag set stable while still
 * receiving patch/minor updates. Re-pin when AuthKit bumps its supported Next major.
 * `@latest` is intentionally avoided — it would reintroduce the flag-drift
 * non-determinism this deterministic step exists to prevent.
 */
export const CREATE_NEXT_APP_VERSION = '16';

const VALID_PACKAGE_MANAGERS: ReadonlySet<string> = new Set<PackageManager>(['npm', 'pnpm', 'yarn', 'bun']);

/**
 * Files that may be present in a directory we still consider "scaffoldable empty".
 *
 * INVARIANT: this MUST stay a subset of create-next-app's own `validFiles`
 * (verified against the v{@link CREATE_NEXT_APP_VERSION} tag). If ours is
 * stricter, we simply scaffold less often (safe). If ours were looser,
 * create-next-app would accept our offer and then refuse mid-run.
 *
 * We omit `docs` and `mkdocs.yml` from the upstream list on purpose — their
 * presence usually signals real project content, so we err toward NOT scaffolding.
 * We also omit `README.md`/`.vscode`: they are NOT in create-next-app's list, so a
 * directory containing them is left to the normal (non-scaffold) install path.
 */
export const SAFE_EMPTY_FILES: ReadonlySet<string> = new Set([
  '.DS_Store',
  '.git',
  '.gitattributes',
  '.gitignore',
  '.gitlab-ci.yml',
  '.hg',
  '.hgcheck',
  '.hgignore',
  '.idea',
  '.npmignore',
  '.travis.yml',
  'LICENSE',
  'Thumbs.db',
  'npm-debug.log',
  'yarn-debug.log',
  'yarn-error.log',
  'yarnrc.yml',
  '.yarn',
]);

/**
 * True iff `dir` is empty or contains only {@link SAFE_EMPTY_FILES} entries.
 *
 * Because no project manifest (`package.json`, `go.mod`, `Gemfile`, etc.) appears
 * in {@link SAFE_EMPTY_FILES}, the presence of any manifest makes this return
 * false — i.e. an existing project always takes the normal install path.
 */
export async function isScaffoldableEmptyDir(dir: string): Promise<boolean> {
  const entries = await readdir(dir);
  return entries.every((entry) => SAFE_EMPTY_FILES.has(entry));
}

/**
 * Resolve the package manager for the scaffolded app.
 *
 * Precedence: validated `--pm` override > `npm_config_user_agent` parse > `npm`.
 * An empty directory has no lockfile, so lockfile-based detection does not apply;
 * we read the runner from the user agent instead (e.g. `pnpm dlx` → `pnpm`).
 */
export function resolvePackageManager(opts: { pm?: string; userAgent?: string }): PackageManager {
  const { pm, userAgent } = opts;

  // `--pm` is validated by yargs `choices` upstream; guard again defensively and
  // fall through on anything unexpected rather than throwing here.
  if (pm && VALID_PACKAGE_MANAGERS.has(pm)) {
    return pm as PackageManager;
  }

  if (userAgent) {
    // e.g. "pnpm/8.6.0 npm/? node/v20.0.0 darwin arm64" → "pnpm"
    const name = userAgent.split(/\s+/)[0]?.split('/')[0];
    if (name && VALID_PACKAGE_MANAGERS.has(name)) {
      return name as PackageManager;
    }
  }

  return 'npm';
}

/**
 * The pinned `create-next-app` flag set. Kept pure so a unit test can assert the
 * exact array — flag drift across a pinned major is the primary failure mode.
 *
 * v1 scaffolds Next.js only. Multi-framework scaffolding (e.g. a Vite React app
 * via its own `create-*` tool) is a tracked follow-up, not implemented.
 *
 * App Router + TypeScript + ESLint + Tailwind + `src/` + `@/*` alias, installed
 * with the resolved package manager. `--yes` accepts all remaining defaults
 * (including the major's Turbopack default) and prevents interactive hangs.
 */
export function buildCreateNextAppArgs(pm: PackageManager): string[] {
  return ['.', '--ts', '--app', '--eslint', '--tailwind', '--src-dir', '--import-alias', '@/*', `--use-${pm}`, '--yes'];
}

/**
 * Each package manager's own package runner. Running create-next-app through the
 * resolved PM's runner (instead of always `npx`) means we don't require npm/npx
 * to be on PATH — e.g. a bun-only machine has no `npx`. `yarn dlx` assumes
 * Yarn >= 2 (Berry); a Yarn 1 user would need `--pm npm`.
 */
const PM_RUNNER: Record<PackageManager, { bin: string; args: string[] }> = {
  npm: { bin: 'npx', args: ['--yes'] },
  pnpm: { bin: 'pnpm', args: ['dlx'] },
  yarn: { bin: 'yarn', args: ['dlx'] },
  bun: { bin: 'bunx', args: [] },
};

/**
 * Spawn `create-next-app@<pinned> .` in `installDir` via the resolved package
 * manager's runner, streaming output as `scaffold:progress` events. Resolves on
 * exit 0; rejects on non-zero exit or spawn error so the state machine can route
 * to its error state.
 */
export function runCreateNextApp(opts: {
  installDir: string;
  packageManager: PackageManager;
  emitter: InstallerEventEmitter;
}): Promise<void> {
  const { installDir, packageManager, emitter } = opts;
  const runner = PM_RUNNER[packageManager];
  const args = [
    ...runner.args,
    `create-next-app@${CREATE_NEXT_APP_VERSION}`,
    ...buildCreateNextAppArgs(packageManager),
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn(runner.bin, args, {
      cwd: installDir,
      env: process.env,
      ...SPAWN_OPTS,
    });

    let stderr = '';

    const stream = (data: Buffer): void => {
      emitter.emit('scaffold:progress', { text: data.toString() });
    };

    child.stdout?.on('data', stream);
    child.stderr?.on('data', (data: Buffer) => {
      // Bound the buffer at collection time so a pathological failure (e.g. a full
      // npm resolution trace) can't accumulate hundreds of KB. Progress still streams.
      if (stderr.length < 2000) {
        stderr += data.toString();
      }
      stream(data);
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const detail = stderr ? `: ${stderr.trim().slice(0, 2000)}` : '';
        // code is null when the process was killed by a signal (e.g. SIGTERM from a
        // timeout layer); surface that instead of masking it as "exited with code 1".
        const exitInfo = code !== null ? `exited with code ${code}` : `was killed by signal ${signal ?? 'unknown'}`;
        reject(new Error(`create-next-app ${exitInfo}${detail}`));
      }
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}
