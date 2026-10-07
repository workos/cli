import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  AGENTS_MD_BEGIN,
  AGENTS_MD_END,
  buildAuthkitBlock,
  gatherFacts,
  upsertBlock,
  writeAgentsMdAfterInstall,
} from './agents-md.js';

// Dummy secrets: neither may ever appear in AGENTS.md or CLAUDE.md.
const API_KEY = 'sk_test_DUMMY_agents_md_0123456789';
const COOKIE_PASSWORD = 'cookie-password-DUMMY-0123456789abcdef';

let dir: string;

function write(path: string, content: string) {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), content);
}
const read = (path: string) => readFileSync(join(dir, path), 'utf-8');
const installed = (pkg: string, version: string, readme = true) => {
  write(`node_modules/${pkg}/package.json`, JSON.stringify({ name: pkg, version }));
  if (readme) write(`node_modules/${pkg}/README.md`, '# readme\n');
};
const env = (lines: string[]) =>
  write('.env.local', [`WORKOS_API_KEY=${API_KEY}`, `WORKOS_COOKIE_PASSWORD=${COOKIE_PASSWORD}`, ...lines].join('\n'));

/** What the Next.js installer leaves behind on Next 16 with a src/ layout. */
function nextjsProject(sdkVersion = '4.4.0') {
  write('package.json', '{"dependencies":{"next":"16.4.0"}}');
  installed('next', '16.4.0', false);
  installed('@workos-inc/authkit-nextjs', sdkVersion);
  write('src/app/layout.tsx', 'export default function Layout() {}\n');
  write('src/proxy.ts', "import { authkitProxy } from '@workos-inc/authkit-nextjs';\nexport default authkitProxy();\n");
  write('src/app/auth/callback/route.ts', "import { handleAuth } from '@workos-inc/authkit-nextjs';\n");
  write('src/app/(auth)/sign-in/route.ts', "import { getSignInUrl } from '@workos-inc/authkit-nextjs';\n");
  env(['WORKOS_CLIENT_ID=client_123', 'NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/auth/callback']);
}

function tanstackProject() {
  write('package.json', '{"dependencies":{"@tanstack/react-start":"1.170.0"}}');
  installed('@workos/authkit-tanstack-react-start', '0.11.1');
  write(
    'src/start.ts',
    'export const startInstance = createStart(() => ({ requestMiddleware: [createCsrfMiddleware({}), authkitMiddleware()] }));\n',
  );
  write('src/routes/api/auth/callback.tsx', 'server: { handlers: { GET: handleCallbackRoute() } }\n');
  write('src/routes/api/auth/sign-in.tsx', 'const url = await getSignInUrl();\n');
  env(['WORKOS_CLIENT_ID=client_123', 'WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback']);
}

const run = (integration = 'nextjs', options = {}) =>
  writeAgentsMdAfterInstall({ installDir: dir, integration, options });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agents-md-'));
  mkdirSync(join(dir, '.git')); // stop node_modules lookup at the project
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.WORKOS_API_KEY;
  delete process.env.WORKOS_COOKIE_PASSWORD;
});

describe('writeAgentsMdAfterInstall', () => {
  it('creates AGENTS.md in a fresh project and a CLAUDE.md that imports it', async () => {
    nextjsProject();
    await expect(run()).resolves.toEqual({ agentsMd: 'created', claudeMd: 'created' });
    const agents = read('AGENTS.md');
    expect(agents.startsWith(`${AGENTS_MD_BEGIN}\n`)).toBe(true);
    expect(agents.endsWith(`${AGENTS_MD_END}\n`)).toBe(true);
    expect(read('CLAUDE.md')).toBe('@AGENTS.md\n');
  });

  it('appends the block once to an existing AGENTS.md, leaving its content byte-for-byte', async () => {
    nextjsProject();
    const original = '# Project rules\r\n\r\nUse tabs.'; // CRLF, no trailing newline
    write('AGENTS.md', original);
    await expect(run()).resolves.toMatchObject({ agentsMd: 'updated' });
    const agents = read('AGENTS.md');
    expect(agents.startsWith(`${original}\r\n\r\n${AGENTS_MD_BEGIN}\r\n`)).toBe(true);
    expect(agents.split(AGENTS_MD_BEGIN)).toHaveLength(2);
    expect(agents.replace(/\r\n/g, '')).toBe(agents.replace(/\r?\n/g, '')); // no bare LF mixed in
    await expect(run()).resolves.toEqual({ agentsMd: 'unchanged', claudeMd: 'unchanged' });
    expect(read('AGENTS.md')).toBe(agents);
  });

  it('replaces the block in place when the version or framework changes, never duplicating it', async () => {
    nextjsProject('3.0.1');
    const before = '# Before\n\n';
    const after = '\n\n## After\nkeep me\n';
    write('AGENTS.md', `${before}${AGENTS_MD_BEGIN}\nstale\n${AGENTS_MD_END}${after}`);
    await run();
    let agents = read('AGENTS.md');
    expect(agents).toContain('`@workos-inc/authkit-nextjs` 3.0.1');
    expect(agents).not.toContain('stale');

    installed('@workos-inc/authkit-nextjs', '4.4.0');
    await run();
    agents = read('AGENTS.md');
    expect(agents).toContain('`@workos-inc/authkit-nextjs` 4.4.0');
    expect(agents).not.toContain('3.0.1');

    tanstackProject();
    await run('tanstack-start');
    agents = read('AGENTS.md');
    expect(agents).toContain('TanStack Start');
    expect(agents).not.toContain('Next.js');
    expect(agents.split(AGENTS_MD_BEGIN)).toHaveLength(2);
    expect(agents.startsWith(before)).toBe(true);
    expect(agents.endsWith(`${AGENTS_MD_END}${after}`)).toBe(true);
  });

  it('adds @AGENTS.md to an existing CLAUDE.md only when missing, and never twice', async () => {
    nextjsProject();
    write('CLAUDE.md', '# Claude notes\n');
    await expect(run()).resolves.toMatchObject({ claudeMd: 'updated' });
    expect(read('CLAUDE.md')).toBe('# Claude notes\n\n@AGENTS.md\n');
    await expect(run()).resolves.toMatchObject({ claudeMd: 'unchanged' });
    expect(read('CLAUDE.md')).toBe('# Claude notes\n\n@AGENTS.md\n');

    write('CLAUDE.md', '@./AGENTS.md\n\nMore notes');
    await expect(run()).resolves.toMatchObject({ claudeMd: 'unchanged' });
  });

  it('leaves a CLAUDE.md symlinked to AGENTS.md alone instead of making it import itself', async () => {
    nextjsProject();
    write('AGENTS.md', '# Shared\n');
    symlinkSync('AGENTS.md', join(dir, 'CLAUDE.md'));
    await expect(run()).resolves.toEqual({ agentsMd: 'updated', claudeMd: 'skipped' });
    expect(read('AGENTS.md')).not.toContain('@AGENTS.md');
  });

  it('writes neither file with --no-agents-md', async () => {
    nextjsProject();
    await expect(run('nextjs', { noAgentsMd: true })).resolves.toBeUndefined();
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('never writes secret values from the environment or .env.local', async () => {
    process.env.WORKOS_API_KEY = API_KEY;
    process.env.WORKOS_COOKIE_PASSWORD = COOKIE_PASSWORD;
    nextjsProject();
    write('.env', `WORKOS_API_KEY=${API_KEY}\nWORKOS_COOKIE_PASSWORD=${COOKIE_PASSWORD}\n`);
    write('CLAUDE.md', '# notes\n');
    await run();
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      expect(read(file)).not.toContain(API_KEY);
      expect(read(file)).not.toContain(COOKIE_PASSWORD);
      expect(read(file)).not.toContain('client_123');
    }
    expect(read('AGENTS.md')).toContain('`WORKOS_API_KEY`');
  });

  it.each(['ruby', 'python', 'go'])('writes nothing for the non-JS %s integration', async (integration) => {
    nextjsProject();
    await expect(run(integration)).resolves.toBeUndefined();
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false);
  });

  it('writes nothing when the installed SDK or the env file cannot be found', async () => {
    write('.env.local', 'WORKOS_CLIENT_ID=client_123\n');
    await expect(run('sveltekit')).resolves.toBeUndefined();
    installed('@workos/authkit-sveltekit', '0.3.0');
    rmSync(join(dir, '.env.local'));
    await expect(run('sveltekit')).resolves.toBeUndefined();
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false);
  });
});

describe('block content', () => {
  const block = async (integration: string) => {
    const facts = await gatherFacts(dir, integration);
    expect(facts).toBeDefined();
    return buildAuthkitBlock(integration, facts!);
  };

  it('Next.js', async () => {
    nextjsProject();
    expect(await block('nextjs')).toMatchSnapshot();
  });

  it('TanStack Start', async () => {
    tanstackProject();
    expect(await block('tanstack-start')).toMatchSnapshot();
  });

  it('React Router', async () => {
    write('package.json', '{"dependencies":{"react-router":"7.9.0"}}');
    installed('@workos-inc/authkit-react-router', '0.13.0');
    write('app/routes/callback.ts', 'export const loader = authLoader();\n');
    write('app/routes/login.ts', 'const { url, headers } = await getSignInUrl(undefined, request);\n');
    env(['WORKOS_CLIENT_ID=client_123', 'WORKOS_REDIRECT_URI=http://localhost:5173/callback']);
    expect(await block('react-router')).toMatchSnapshot();
  });

  it('generic JS integration (SvelteKit) names only what the installer wrote', async () => {
    installed('@workos/authkit-sveltekit', '0.3.0');
    env(['WORKOS_CLIENT_ID=client_123', 'WORKOS_REDIRECT_URI=http://localhost:5173/callback']);
    expect(await block('sveltekit')).toMatchSnapshot();
  });

  it('omits traps the installed version does not have', async () => {
    nextjsProject('2.15.0');
    const text = await block('nextjs');
    expect(text).not.toContain('getUser');
    expect(text).not.toContain('OAuth state mismatch');
    expect(text).toContain('never a GET route');
  });

  it('uses the --redirect-uri path for the callback', async () => {
    installed('@workos/authkit-sveltekit', '0.3.0');
    env(['WORKOS_CLIENT_ID=client_123']);
    const facts = await gatherFacts(dir, 'sveltekit', 'https://app.example.com/oauth/return');
    expect(await buildAuthkitBlock('sveltekit', facts!)).toContain('`/oauth/return`');
  });
});

describe('upsertBlock', () => {
  it('appends to an empty file and keeps a trailing newline', () => {
    expect(upsertBlock('', 'B')).toBe('B\n');
    expect(upsertBlock('text\n', 'B')).toBe('text\n\nB\n');
  });
});
