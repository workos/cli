/**
 * After a successful install, write a short AuthKit block into the project's
 * AGENTS.md and make CLAUDE.md import it, so coding agents read guidance that
 * matches the SDK version actually installed instead of guessing at stale APIs.
 *
 * Mirrors the approach of Next.js's `generate-agent-files` (16.3+): a marker-
 * delimited block that a rerun replaces in place, never touching anything
 * outside the markers. Every line states something the installer wrote or
 * verified for the installed version; when a fact can't be established, the
 * line (or the whole block) is left out, because agents trust this file.
 *
 * Non-JS integrations (python, ruby, php, php-laravel, go, dotnet, elixir,
 * kotlin) are deliberately skipped. TODO: to get an accurate block, each would
 * need to report the SDK package and resolved version it installed (from the
 * lockfile: Gemfile.lock, uv.lock/poetry.lock, composer.lock, go.sum, the
 * .csproj, mix.lock, Gradle) and the env var names its agent wrote, since the
 * installer doesn't write their env files itself.
 */
import { existsSync } from 'node:fs';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import fg from 'fast-glob';
import * as semver from 'semver';
import type { InstallerOptions } from '../utils/types.js';
import { getCallbackPath, getSignInPath } from './port-detection.js';
import { logError } from '../utils/debug.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

export const AGENTS_MD_BEGIN = '<!-- BEGIN:workos-authkit -->';
export const AGENTS_MD_END = '<!-- END:workos-authkit -->';
const CLAUDE_IMPORT = '@AGENTS.md';

/** Every env var name `configureInstallEnvironment` + `writeEnvLocal` can write. */
const INSTALLER_ENV_NAMES = [
  'WORKOS_API_KEY',
  'WORKOS_CLIENT_ID',
  'WORKOS_REDIRECT_URI',
  'NEXT_PUBLIC_WORKOS_REDIRECT_URI',
  'WORKOS_COOKIE_PASSWORD',
  'VITE_WORKOS_CLIENT_ID',
  'VITE_WORKOS_REDIRECT_URI',
  'REACT_APP_WORKOS_CLIENT_ID',
  'REACT_APP_WORKOS_REDIRECT_URI',
];
const SERVER_ONLY_ENV_NAMES = ['WORKOS_API_KEY', 'WORKOS_COOKIE_PASSWORD'];

export interface AuthkitFacts {
  installDir: string;
  framework: string;
  sdk: string;
  version: string;
  /** Project-relative path to the SDK README shipped in node_modules. */
  readme?: string;
  callbackPath: string;
  /** Names present in .env.local that the installer writes. Never values. */
  envVars: string[];
}

type Section = (facts: AuthkitFacts) => Promise<string[]>;

const PROFILES: Record<string, { framework: string; sdk: string; section?: Section }> = {
  nextjs: { framework: 'Next.js', sdk: '@workos-inc/authkit-nextjs', section: nextjsSection },
  'react-router': { framework: 'React Router', sdk: '@workos-inc/authkit-react-router', section: reactRouterSection },
  'tanstack-start': {
    framework: 'TanStack Start',
    sdk: '@workos/authkit-tanstack-react-start',
    section: tanstackStartSection,
  },
  react: { framework: 'React', sdk: '@workos-inc/authkit-react' },
  'vanilla-js': { framework: 'vanilla JavaScript', sdk: '@workos-inc/authkit-js' },
  sveltekit: { framework: 'SvelteKit', sdk: '@workos/authkit-sveltekit' },
  node: { framework: 'Node.js (Express)', sdk: '@workos-inc/node' },
};

export type FileAction = 'created' | 'updated' | 'unchanged' | 'skipped';

/**
 * The post-install hook. Never throws: a failure here must not fail an install
 * that already succeeded.
 */
export async function writeAgentsMdAfterInstall(input: {
  installDir: string;
  integration?: string;
  options?: Pick<InstallerOptions, 'noAgentsMd' | 'redirectUri'>;
}): Promise<{ agentsMd: FileAction; claudeMd: FileAction } | undefined> {
  if (input.options?.noAgentsMd || !input.integration) return undefined;
  try {
    const facts = await gatherFacts(input.installDir, input.integration, input.options?.redirectUri);
    if (!facts) return undefined;
    return await writeAgentFiles(input.installDir, await buildAuthkitBlock(input.integration, facts));
  } catch (error) {
    logError('Could not write the AuthKit block to AGENTS.md:', error);
    return undefined;
  }
}

export async function gatherFacts(
  installDir: string,
  integration: string,
  redirectUri?: string,
): Promise<AuthkitFacts | undefined> {
  const profile = PROFILES[integration];
  if (!profile) return undefined;
  const pkg = await readInstalledPackage(installDir, profile.sdk);
  const envVars = await readEnvNames(installDir);
  if (!pkg || envVars.length === 0) return undefined;
  let callbackPath = getCallbackPath(integration);
  if (redirectUri) {
    try {
      callbackPath = new URL(redirectUri).pathname;
    } catch {
      return undefined;
    }
  }
  return { installDir, framework: profile.framework, sdk: profile.sdk, ...pkg, callbackPath, envVars };
}

export async function buildAuthkitBlock(integration: string, facts: AuthkitFacts): Promise<string> {
  const { sdk, version, readme, framework, envVars } = facts;
  const serverOnly = envVars.filter((name) => SERVER_ONLY_ENV_NAMES.includes(name));
  const docs = readme ? `read \`${readme}\`` : `check \`node_modules/${sdk}\``;
  const section = PROFILES[integration]?.section;
  const installCommand = formatWorkOSCommand('install');
  const lines = [
    AGENTS_MD_BEGIN,
    '',
    '## WorkOS AuthKit',
    '',
    `\`${installCommand}\` set up authentication for ${framework} with \`${sdk}\` ${version}. Its API may differ from your training data: ${docs} before changing auth code.`,
    '',
    ...(section ? await section(facts) : [`- ${keepCallback(facts)}`, '']),
    '### Environment',
    '',
    "Names only. The values live in `.env.local`, which is git-ignored; don't copy them into code or commit them.",
    '',
    `- ${envVars.map((name) => `\`${name}\``).join(', ')}`,
    ...(serverOnly.length
      ? [
          `- ${serverOnly.map((name) => `\`${name}\``).join(' and ')} ${serverOnly.length > 1 ? 'are' : 'is'} server-only. ${integration === 'nextjs' ? 'Never give them a `NEXT_PUBLIC_` prefix or read them in client components.' : 'Never expose them to browser code.'}`,
        ]
      : []),
    '',
    `\`${installCommand}\` wrote this block and replaces it when it runs again. Keep your own notes outside the markers.`,
    '',
    AGENTS_MD_END,
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Per-framework sections: what the installer set up, verified stale-API traps,
// and what not to undo. Files are only named when they exist on disk.
// ---------------------------------------------------------------------------

async function nextjsSection(facts: AuthkitFacts): Promise<string[]> {
  const { installDir: dir, version, callbackPath } = facts;
  const root = existsSync(join(dir, 'src', 'app')) ? 'src/' : '';
  const proxy = await firstFileContaining(
    dir,
    ['proxy', 'middleware'].flatMap((name) => [`${root}${name}.ts`, `${root}${name}.js`]),
    facts.sdk,
  );
  const callback = await findNextRoute(dir, root, callbackPath);
  const signInPath = getSignInPath('nextjs');
  const signIn = signInPath ? await findNextRoute(dir, root, signInPath) : undefined;
  const nextVersion = (await readInstalledPackage(dir, 'next'))?.version;
  const isProxy = proxy?.split('/').pop()?.startsWith('proxy.');
  return [
    ...setUp([
      proxy && `\`${proxy}\`: runs AuthKit on matched requests. \`withAuth()\` only works on routes it covers.`,
      callback && `\`${callback}\`: the OAuth callback at \`${callbackPath}\`.`,
      signIn && `\`${signIn}\`: starts sign-in at \`${signInPath}\`.`,
    ]),
    ...traps([
      atLeast(version, '4.0.0') && 'Read the session with `withAuth()`. There is no `getUser` export.',
      atLeast(version, '4.0.0') &&
        'Import `AuthKitProvider` and `useAuth` from `@workos-inc/authkit-nextjs/components`, not the package root.',
      atLeast(version, '3.0.0') &&
        'Start sign-in with `getSignInUrl()` in a route handler or server action, or `refreshAuth({ ensureSignedIn: true })` from a client click handler. The callback checks a state cookie these set, so a hand-built authorization URL fails with "OAuth state mismatch".',
      'Sign out by calling `signOut()` from a server action or POST handler, never a GET route: link prefetching would log users out.',
    ]),
    ...dontUndo([
      proxy &&
        `Keep \`${proxy}\` at the same level as \`${root}app/\`; Next.js ignores a proxy file anywhere else.${isProxy && nextVersion && atLeast(nextVersion, '16.0.0') ? ' Next.js 16 renamed `middleware.ts` to `proxy.ts`, so renaming it back is wrong too.' : ''}`,
      callback && keepCallback(facts),
    ]),
  ];
}

async function reactRouterSection(facts: AuthkitFacts): Promise<string[]> {
  const { installDir: dir, version, callbackPath } = facts;
  // `authLoader` as a word: called, assigned, or re-exported (`export { authLoader as loader }`).
  const callback = await findCallbackRoute(dir, callbackPath, /\bauthLoader\b/);
  const signIn = await findSourceContaining(dir, '{app,src}/routes/**/*.{ts,tsx,js,jsx}', 'getSignInUrl(');
  return [
    ...setUp([
      callback && `\`${callback}\`: the OAuth callback at \`${callbackPath}\` (\`authLoader\`).`,
      signIn && `\`${signIn}\`: calls \`getSignInUrl()\` to start sign-in.`,
    ]),
    ...traps([
      atLeast(version, '0.11.0') &&
        '`getSignInUrl()` and `getSignUpUrl()` return `{ url, headers }`, not a string. Return `redirect(url, { headers })` from a loader or action; a URL rendered into a `<Link>` drops the PKCE cookie and the callback rejects the sign-in.',
    ]),
    ...dontUndo([callback && keepCallback(facts)]),
  ];
}

async function tanstackStartSection(facts: AuthkitFacts): Promise<string[]> {
  const { installDir: dir, version, callbackPath } = facts;
  const start = await firstFileContaining(
    dir,
    ['src/start.ts', 'src/start.tsx', 'app/start.ts', 'app/start.tsx'],
    'authkitMiddleware',
  );
  const startSource = start ? await readFile(join(dir, start), 'utf-8') : '';
  const callback = await findCallbackRoute(dir, callbackPath, 'handleCallbackRoute');
  const signIn = await findSourceContaining(dir, '{src,app}/routes/**/*.{ts,tsx,js,jsx}', 'getSignInUrl(');
  return [
    ...setUp([
      start && `\`${start}\`: registers \`authkitMiddleware()\` in \`requestMiddleware\`.`,
      callback && `\`${callback}\`: the OAuth callback at \`${callbackPath}\` (\`handleCallbackRoute()\`).`,
      signIn && `\`${signIn}\`: calls \`getSignInUrl()\` to start sign-in.`,
    ]),
    ...traps([
      atLeast(version, '0.7.0') &&
        'Start every sign-in from `getSignInUrl()`. The callback requires the per-flow PKCE cookie it sets; a flow that skips it fails with `PKCECookieMissingError`.',
      atLeast(version, '0.11.0') &&
        '`AuthKitProvider` and `useAuth` come from `@workos/authkit-tanstack-react-start/client`; server helpers come from the package root.',
    ]),
    ...dontUndo([
      start &&
        `Keep \`authkitMiddleware()\` in \`${start}\`. Without it, server helpers throw "AuthKit middleware is not configured".`,
      start &&
        startSource.includes('createCsrfMiddleware') &&
        "Keep `createCsrfMiddleware` ahead of it: defining `startInstance` turns off TanStack Start's default CSRF protection, and this restores it.",
      callback && keepCallback(facts),
    ]),
  ];
}

/** The installer registered this callback in WorkOS and wrote its URI to .env.local. */
function keepCallback({ envVars, callbackPath }: AuthkitFacts): string {
  const uriVar = envVars.find((name) => name.endsWith('WORKOS_REDIRECT_URI'));
  return `Keep the OAuth callback at \`${callbackPath}\`: it must match ${uriVar ? `\`${uriVar}\` and ` : ''}the redirect URI registered in WorkOS.`;
}

type Line = string | false | undefined;
const list = (heading: string, lines: Line[]): string[] => {
  const kept = lines.filter((line): line is string => Boolean(line));
  return kept.length ? [heading, '', ...kept.map((line) => `- ${line}`), ''] : [];
};
const setUp = (lines: Line[]) => list('### Set up by the installer', lines);
const traps = (lines: Line[]) => list('### Stale APIs to avoid', lines);
const dontUndo = (lines: Line[]) => list("### Don't undo", lines);

function atLeast(version: string, min: string): boolean {
  const coerced = semver.coerce(version);
  return coerced !== null && semver.gte(coerced, min);
}

// ---------------------------------------------------------------------------
// Facts from disk
// ---------------------------------------------------------------------------

/** Find `pkg` in node_modules from installDir up to the repository root. */
async function readInstalledPackage(
  installDir: string,
  pkg: string,
): Promise<{ version: string; readme?: string } | undefined> {
  for (let dir = installDir; ; dir = dirname(dir)) {
    const pkgDir = join(dir, 'node_modules', pkg);
    try {
      const { version } = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf-8'));
      if (typeof version !== 'string') return undefined;
      const readme = join(pkgDir, 'README.md');
      return { version, ...(existsSync(readme) ? { readme: toPosix(relative(installDir, readme)) } : {}) };
    } catch {
      // Not installed at this level.
    }
    if (existsSync(join(dir, '.git')) || dirname(dir) === dir) return undefined;
  }
}

/** Names (never values) of installer-written env vars present in .env.local. */
async function readEnvNames(installDir: string): Promise<string[]> {
  let content: string;
  try {
    content = await readFile(join(installDir, '.env.local'), 'utf-8');
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const name = /^[ \t]*(?:export[ \t]+)?([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/.exec(line)?.[1];
    if (name) names.add(name);
  }
  return INSTALLER_ENV_NAMES.filter((name) => names.has(name));
}

async function firstFileContaining(
  dir: string,
  candidates: string[],
  needle: string | RegExp,
): Promise<string | undefined> {
  for (const file of candidates) {
    try {
      const source = await readFile(join(dir, file), 'utf-8');
      if (typeof needle === 'string' ? source.includes(needle) : needle.test(source)) return file;
    } catch {
      // Missing candidate.
    }
  }
  return undefined;
}

async function findSourceContaining(
  dir: string,
  pattern: string,
  needle: string | RegExp,
): Promise<string | undefined> {
  const files = (await fg(pattern, { cwd: dir, ignore: ['**/node_modules/**'] })).sort();
  return firstFileContaining(dir, files, needle);
}

/**
 * The React Router / TanStack Start route file for `urlPath` that uses `needle`:
 * the conventional nested or flat file under app/routes or src/routes first
 * (as the validator checks), then any source file using it (e.g. config-based routes).
 */
async function findCallbackRoute(dir: string, urlPath: string, needle: string | RegExp): Promise<string | undefined> {
  const path = urlPath.replace(/^\/+|\/+$/g, '');
  const conventional = ['app', 'src'].flatMap((root) =>
    [path, path.replace(/\//g, '.')].flatMap((name) =>
      ['', '/index', '/route', '.index', '.route'].flatMap((suffix) =>
        ['ts', 'tsx', 'js', 'jsx'].map((ext) => `${root}/routes/${name}${suffix}.${ext}`),
      ),
    ),
  );
  return (
    (await firstFileContaining(dir, conventional, needle)) ??
    findSourceContaining(dir, '{app,src}/**/*.{ts,tsx,js,jsx}', needle)
  );
}

/** The App Router `route.*` file serving `urlPath`, ignoring `(group)` segments. */
async function findNextRoute(dir: string, root: string, urlPath: string): Promise<string | undefined> {
  const appDir = `${root}app/`;
  const want = urlPath.replace(/\/+$/, '');
  const files = (await fg(`${appDir}**/route.{ts,tsx,js,jsx}`, { cwd: dir })).sort();
  return files.find((file) => {
    const segments = file.slice(appDir.length).split('/').slice(0, -1);
    return `/${segments.filter((s) => !/^\(.*\)$/.test(s)).join('/')}` === want;
  });
}

const toPosix = (path: string) => path.split(sep).join('/');

// ---------------------------------------------------------------------------
// File writes (mirrors next/dist/server/lib/generate-agent-files.js)
// ---------------------------------------------------------------------------

/**
 * Upsert `block` into AGENTS.md (creating it if missing) and make CLAUDE.md
 * import it. Content outside the markers is never changed.
 */
async function writeAgentFiles(
  installDir: string,
  block: string,
): Promise<{ agentsMd: FileAction; claudeMd: FileAction }> {
  const agentsPath = join(installDir, 'AGENTS.md');
  const claudePath = join(installDir, 'CLAUDE.md');
  const agentsMd = await upsertFile(agentsPath, (existing) => upsertBlock(existing, block));
  // A CLAUDE.md symlinked to AGENTS.md (or the reverse) already shares the block;
  // an import there would make the file import itself.
  if (existsSync(claudePath) && (await realpath(claudePath)) === (await realpath(agentsPath))) {
    return { agentsMd, claudeMd: 'skipped' };
  }
  const claudeMd = await upsertFile(claudePath, ensureImport);
  return { agentsMd, claudeMd };
}

async function upsertFile(path: string, update: (existing: string) => string): Promise<FileAction> {
  let existing: string | undefined;
  try {
    existing = await readFile(path, 'utf-8');
  } catch (error) {
    // Only a missing file may be created. Any other read error (permissions, a
    // directory) stops the update rather than overwriting what we couldn't read.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const next = update(existing ?? '');
  if (next === existing) return 'unchanged';
  await writeFile(path, next, 'utf-8');
  return existing === undefined ? 'created' : 'updated';
}

const detectEol = (content: string) => (content.includes('\r\n') ? '\r\n' : '\n');
/** Blank line before appended content, unless the file is empty. */
const appendSeparator = (existing: string, eol: string) =>
  existing.length === 0 ? '' : /\r?\n$/.test(existing) ? eol : eol + eol;

export function upsertBlock(existing: string, block: string): string {
  const eol = detectEol(existing);
  const normalized = block.replace(/\r?\n/g, eol);
  const start = existing.indexOf(AGENTS_MD_BEGIN);
  if (start === -1) return existing + appendSeparator(existing, eol) + normalized + eol;
  const end = existing.indexOf(AGENTS_MD_END, start);
  // An unmatched or repeated opening marker can't be paired safely: appending a
  // block would let a later run replace the user's text between the markers.
  const nextStart = existing.indexOf(AGENTS_MD_BEGIN, start + 1);
  if (end === -1 || (nextStart !== -1 && nextStart < end)) {
    throw new Error(`AGENTS.md has an unmatched ${AGENTS_MD_BEGIN} marker; fix the markers and rerun.`);
  }
  return existing.slice(0, start) + normalized + existing.slice(end + AGENTS_MD_END.length);
}

function ensureImport(existing: string): string {
  if (existing.split(/\r?\n/).some((line) => ['@AGENTS.md', '@./AGENTS.md'].includes(line.trim()))) {
    return existing;
  }
  const eol = detectEol(existing);
  return existing + appendSeparator(existing, eol) + CLAUDE_IMPORT + eol;
}
