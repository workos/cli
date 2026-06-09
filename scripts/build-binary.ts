// Compile the WorkOS CLI into a standalone Bun binary.
//
//   bun run build:binary
//
// Produces dist-bin/workos for the current platform. Cross-compilation and
// signing are deferred (see CLAUDE.md) — this target is for local testing of
// the compiled binary.
//
// Two SDK assets cannot be resolved from inside a single-file binary and are
// embedded here, then extracted to ~/.workos/runtime at first agent run:
//   1. The Claude Code native binary the Agent SDK spawns (shipped per-platform
//      as an optionalDependency of @anthropic-ai/claude-agent-sdk).
//   2. The @workos/skills plugin directory (markdown/yaml the agent loads).
// Both are injected into src/lib/sdk-runtime/embedded-assets.ts at compile time.
import type { BunPlugin } from 'bun';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const OUT_DIR = 'dist-bin';
const OUTFILE = `${OUT_DIR}/workos`;

// ink lazily imports `react-devtools-core` only when its dev tools are enabled.
// It is an optional dependency that is not installed in production, so the
// --compile bundler cannot resolve it. Replace it with a no-op stub module.
const stubReactDevtools: BunPlugin = {
  name: 'stub-react-devtools-core',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'react-devtools-core',
      namespace: 'stub-rdc',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-rdc' }, () => ({
      contents: 'export function connectToDevTools() {}\nexport default { connectToDevTools };\n',
      loader: 'js',
    }));
  },
};

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

function resolveClaudeBinary(): string {
  const { platform, arch } = process;
  // musl/win variants are not handled here (deferred with cross-compile).
  const pkg = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
  const bin = resolve('node_modules', pkg, 'claude');
  if (!existsSync(bin)) {
    throw new Error(
      `Claude Code native binary not found at ${bin}. ` +
        `Run \`bun install\` (without --omit=optional) on ${platform}-${arch}.`,
    );
  }
  return bin;
}

async function buildSkillsMap(skillsRoot: string): Promise<Record<string, string>> {
  const pluginsDir = join(skillsRoot, 'plugins');
  if (!existsSync(pluginsDir)) {
    throw new Error(`@workos/skills plugins dir not found at ${pluginsDir}`);
  }
  const map: Record<string, string> = {};
  const entries = await readdir(pluginsDir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath ?? entry.path ?? pluginsDir;
    const abs = join(parent, entry.name);
    const rel = relative(skillsRoot, abs); // e.g. plugins/workos/skills/workos/SKILL.md
    map[rel] = (await readFile(abs)).toString('base64');
  }
  return map;
}

async function buildEmbedPlugin(): Promise<BunPlugin> {
  const claudeBin = resolveClaudeBinary();
  const sdkVersion = (await readJson('node_modules/@anthropic-ai/claude-agent-sdk/package.json')).version as string;

  const skillsRoot = resolve('node_modules/@workos/skills');
  const skillsVersion = (await readJson(join(skillsRoot, 'package.json'))).version as string;
  const skillsMap = await buildSkillsMap(skillsRoot);

  const claudeMb = ((await stat(claudeBin)).size / 1024 / 1024).toFixed(1);
  const skillsBytes = Object.values(skillsMap).reduce((n, b64) => n + b64.length, 0);
  console.log(
    `Embedding: claude ${sdkVersion} (${claudeMb} MB native binary), ` +
      `@workos/skills ${skillsVersion} (${Object.keys(skillsMap).length} files, ~${(skillsBytes / 1024 / 1024).toFixed(1)} MB base64)`,
  );

  const contents =
    `import claudePath from ${JSON.stringify(claudeBin)} with { type: 'file' };\n` +
    `export const EMBEDDED_CLAUDE_PATH = claudePath;\n` +
    `export const EMBEDDED_SKILLS = ${JSON.stringify(skillsMap)};\n` +
    `export const EMBEDDED_SKILLS_VERSION = ${JSON.stringify(skillsVersion)};\n`;

  return {
    name: 'embed-sdk-assets',
    setup(build) {
      build.onResolve({ filter: /(^|\/)embedded-assets(\.[tj]s)?$/ }, () => ({
        path: 'embedded-assets',
        namespace: 'embed-assets',
      }));
      build.onLoad({ filter: /.*/, namespace: 'embed-assets' }, () => ({
        contents,
        loader: 'js',
        resolveDir: process.cwd(),
      }));
    },
  };
}

async function main(): Promise<void> {
  const start = performance.now();
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const embedPlugin = await buildEmbedPlugin();

  const result = await Bun.build({
    entrypoints: ['src/bin.ts'],
    target: 'bun',
    plugins: [stubReactDevtools, embedPlugin],
    compile: {
      outfile: OUTFILE,
    },
  });

  if (!result.success) {
    console.error('Binary build failed:');
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const { size } = await stat(OUTFILE);
  const mb = (size / 1024 / 1024).toFixed(1);
  const secs = ((performance.now() - start) / 1000).toFixed(1);
  console.log(`Built ${OUTFILE} (${mb} MB) in ${secs}s`);
}

await main();
