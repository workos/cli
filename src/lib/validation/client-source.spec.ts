import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateInstallation } from './validator.js';

let project: string;
async function file(path: string, content: string) {
  await mkdir(dirname(join(project, path)), { recursive: true });
  await writeFile(join(project, path), content);
}
const client = 'createClient(id, { redirectUri: import.meta.env.VITE_WORKOS_REDIRECT_URI });';
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'client-source-'));
  await file(
    'package.json',
    JSON.stringify({
      dependencies: { '@workos-inc/authkit-js': '^1.0.0' },
      devDependencies: { vite: '^6.0.0' },
    }),
  );
  await file('.env.local', 'WORKOS_CLIENT_ID=client_test\n');
  await file('index.html', '<script type="module" src="/src/main.ts"></script>');
  await file('src/main.ts', client);
});
afterEach(async () => {
  await rm(project, { recursive: true, force: true });
});

it('rejects an unprefixed Node env read in Vite browser code', async () => {
  await file('src/main.ts', 'createClient(id, { redirectUri: process.env.WORKOS_REDIRECT_URI });');
  const result = await validateInstallation('vanilla-js', project, { runBuild: false });
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      severity: 'error',
      message:
        'The client reads process.env.WORKOS_REDIRECT_URI, but the installer exposes import.meta.env.VITE_WORKOS_REDIRECT_URI',
    }),
  );
});

it.each([
  'server.js',
  'src/server.ts',
  'src/server/auth.ts',
  'scripts/setup.ts',
  'api/auth.ts',
  'functions/auth.ts',
  'src/auth.server.ts',
  'packages/another-app/src/main.ts',
])('does not let %s satisfy browser callback checks or cause env-read errors', async (path) => {
  await file('src/main.ts', 'const app = {};');
  await file(path, 'const redirectUri = process.env.WORKOS_REDIRECT_URI;');
  const result = await validateInstallation('vanilla-js', project, { runBuild: false });
  expect(result.issues.some((issue) => issue.message === 'The AuthKit client does not set redirectUri')).toBe(true);
  expect(result.issues.some((issue) => issue.message.startsWith('The client reads'))).toBe(false);
});

it.each([
  "import Login from '@pages/Login'; export const routes = [{ path: '/login', Component: memo(Login) }];",
  'function Login() { useStartSignIn(); return null; }',
  "switch (location.pathname) { case '/login': authkit.signIn(); }",
  '// No login route yet',
])('requests browser verification without rejecting client route syntax: %s', async (source) => {
  await file('src/login.tsx', source);
  const result = await validateInstallation('vanilla-js', project, { runBuild: false });
  expect(result.passed).toBe(true);
  expect(result.issues).toContainEqual(
    expect.objectContaining({
      severity: 'warning',
      message: 'Client-side /login route requires browser verification',
      hint: expect.stringContaining('the installer leaves that setting unchanged'),
    }),
  );
});

it('checks callback configuration without resolving inline imports or custom aliases', async () => {
  await file('index.html', '<script type="module">import "/src/main.ts";</script>');
  await file('src/main.ts', "import '@features/auth';");
  await file('src/features/auth.ts', client);
  const result = await validateInstallation('vanilla-js', project, { runBuild: false });
  expect(result.passed).toBe(true);
  expect(result.issues.some((issue) => issue.message === 'The AuthKit client does not set redirectUri')).toBe(false);
});

describe('bounded scan', () => {
  async function incomplete() {
    const result = await validateInstallation('vanilla-js', project, { runBuild: false });
    expect(result.passed).toBe(true);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: 'Client source checks were incomplete; callback configuration could not be fully checked',
      }),
    );
    expect(result.issues.some((issue) => issue.message === 'The AuthKit client does not set redirectUri')).toBe(false);
  }
  it('reports an incomplete file set without failing installation', async () => {
    await Promise.all(Array.from({ length: 256 }, (_, i) => file(`src/file-${i}.ts`, 'export {};')));
    await incomplete();
  });
  it('bounds individual file reads without claiming the callback is missing', async () => {
    await file('src/main.ts', ' '.repeat(256 * 1024 + 1));
    await incomplete();
  });
  it('bounds aggregate content, not only individual files', async () => {
    await Promise.all(Array.from({ length: 17 }, (_, i) => file(`src/file-${i}.ts`, ' '.repeat(256 * 1024))));
    await incomplete();
  });
});
