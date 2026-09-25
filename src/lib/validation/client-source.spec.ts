import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { hasClientSignInRoute, validateInstallation } from './validator.js';

let project: string;
async function file(path: string, content: string) {
  await mkdir(dirname(join(project, path)), { recursive: true });
  await writeFile(join(project, path), content);
}
const login = "if (window.location.pathname === '/login') authkit.signIn();";
const client = 'createClient(id, { redirectUri: import.meta.env.VITE_WORKOS_REDIRECT_URI });';
beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'client-source-'));
  await file('package.json', JSON.stringify({ devDependencies: { vite: '^6.0.0' } }));
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
])('does not let server-only %s satisfy browser route or callback checks', async (path) => {
  await file('src/main.ts', 'const app = {};');
  await file(path, `${login}\nconst redirectUri = process.env.WORKOS_REDIRECT_URI;`);
  const result = await validateInstallation('vanilla-js', project, { runBuild: false });
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
  expect(result.issues.some((issue) => issue.message.includes('/login route'))).toBe(true);
  expect(result.issues.some((issue) => issue.message === 'The AuthKit client does not set redirectUri')).toBe(true);
  expect(result.issues.some((issue) => issue.message.startsWith('The client reads'))).toBe(false);
});

it.each([
  "if (redirectTarget === '/login') authkit.signIn();",
  "if ('/login' === redirectTarget) authkit.signIn();",
  "switch(window.location.pathname) {case '/': home();} switch(action) {case '/login': authkit.signIn();}",
  "const links = [{ path: '/login', label: 'Sign in' }]; authkit.signIn();",
  "const path = '/login'; authkit.signIn();",
  '<Route path="/login" element={<h1>Hello</h1>} />',
])('does not mistake unrelated code for a sign-in route: %s', async (source) => {
  await file('src/main.tsx', source);
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
});

it.each([
  login,
  "const current = window.location.pathname; if(current === '/login') authkit.signIn();",
  "if ('/login' === location.pathname) authkit.signIn();",
  "function Login() { useEffect(() => { if (window.location.pathname === '/login') signIn(); }, []); return null; }",
  "function App() { useEffect(() => { if (!loading && window.location.pathname === '/login') void signIn(); }, [loading]); return null; }",
])('accepts supported route evidence and a sign-in call: %s', async (source) => {
  await file('src/auth.config.tsx', source);
  expect(await hasClientSignInRoute(project, '/login')).toBe(true);
});

it('does not need to resolve inline imports or custom aliases to inspect conventional client files', async () => {
  await file('index.html', '<script type="module">import "/src/main.ts";</script>');
  await file('src/main.ts', "import '@features/login';");
  await file('src/features/login.ts', `${login}\n${client}`);
  expect(await hasClientSignInRoute(project, '/login')).toBe(true);
  const result = await validateInstallation('vanilla-js', project, { runBuild: false });
  expect(result.issues.some((issue) => issue.message.includes('/login route'))).toBe(false);
  expect(result.issues.some((issue) => issue.message === 'The AuthKit client does not set redirectUri')).toBe(false);
});

it('does not let a sign-in button in a different file qualify the login route', async () => {
  await file('src/routes.tsx', '<Route path="/login" element={<h1>Hello</h1>} />');
  await file('src/button.tsx', 'export const button = <button onClick={() => signIn()}>Sign in</button>;');
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
  const result = await validateInstallation('react', project, { runBuild: false });
  expect(result.issues.some((issue) => issue.message.includes('/login route'))).toBe(true);
});

it('does not scan other workspaces as this app', async () => {
  await file('src/main.ts', client);
  await file('packages/another-app/src/main.ts', login);
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
});

it.each([
  ['import Login from "./Login";', 'export default function Login()'],
  ['import { Login } from "./Login";', 'export function Login()'],
  ['import { Entry as Login } from "./Login";', 'export function Entry()'],
  ['import Login from "./Login.tsx";', 'export default () =>'],
  ['import Login from "./Login.js";', 'export default function Login()'],
  ['import Login from "./Login.jsx";', 'export default function Login()'],
  ['import { Login } from "./Login";', 'export const Login = () =>'],
  ['import Login from "./Login";', 'const Entry = function()'],
])('resolves a split-file mounted login component: %s', async (importLine, declaration) => {
  await file(
    'src/App.tsx',
    `${importLine} export default function App() {
    return <Route path="/login" element={<Login />} />;
  }`,
  );
  await file(
    'src/Login.tsx',
    `${declaration} {
    const { signIn, isLoading } = useAuth();
    useEffect(() => { if (!isLoading) void signIn(); }, [isLoading, signIn]);
    return <span>Signing in</span>;
  } ${declaration.startsWith('const') ? '; export { Entry as default };' : ''}`,
  );
  expect(await hasClientSignInRoute(project, '/login')).toBe(true);
  const result = await validateInstallation('react', project, { runBuild: false });
  expect(result.issues.some((issue) => issue.message.includes('/login route'))).toBe(false);
});

it.each([
  ['import Login from "./Missing";', 'export default function Login() { useEffect(() => signIn(), []); return null; }'],
  [
    'import Login from "@pages/Login";',
    'export default function Login() { useEffect(() => signIn(), []); return null; }',
  ],
  ['import Login from "./Login";', 'export function Login() { useEffect(() => signIn(), []); return null; }'],
  [
    'import { Missing as Login } from "./Login";',
    'export function Login() { useEffect(() => signIn(), []); return null; }',
  ],
  ['import { Login } from "./Login";', 'function Login() { useEffect(() => signIn(), []); return null; }'],
  [
    'import Login from "./Login";',
    'export default function Page() { return <h1>Login</h1>; } function Login() { useEffect(() => signIn(), []); return null; }',
  ],
  ['import Login from "./Login";', 'export { default } from "./Unrelated";'],
  ['import type { Login } from "./Login";', 'export function Login() { useEffect(() => signIn(), []); return null; }'],
])('fails closed for unresolved or wrong component exports: %s %s', async (importLine, component) => {
  await file(
    'src/App.tsx',
    `${importLine} export default function App() { return <Route path="/login" element={<Login />} />; }`,
  );
  await file('src/Login.tsx', component);
  await file('src/Unrelated.tsx', 'export default function Login() { useEffect(() => signIn(), []); return null; }');
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
  const result = await validateInstallation('react', project, { runBuild: false });
  expect(result.issues.some((issue) => issue.message.includes('/login route'))).toBe(true);
});

it.each(['element: <Login />', 'Component: Login', 'component: Login'])(
  'resolves imported object route %s via a directory index',
  async (target) => {
    await file(
      'src/App.tsx',
      `import { Entry as Login } from './pages'; const routes = [{path: '/login', ${target}}];`,
    );
    await file(
      'src/pages/index.tsx',
      'const Page = () => { useEffect(() => signIn(), []); return null; }; export { Page as Entry };',
    );
    expect(await hasClientSignInRoute(project, '/login')).toBe(true);
  },
);

it('declines ambiguous relative module resolution', async () => {
  await file('src/App.tsx', 'import Login from "./Login"; const routes = [{path: "/login", Component: Login}];');
  await file('src/Login.tsx', 'export default function Login() { useEffect(() => signIn(), []); return null; }');
  await file('src/Login/index.tsx', 'export default function Login() { return null; }');
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
});

it('does not expand the bounded scan to resolve imports', async () => {
  await file(
    'src/App.tsx',
    'import Login from "../packages/Login"; const routes = [{path: "/login", Component: Login}];',
  );
  await file('packages/Login.tsx', 'export default function Login() { useEffect(() => signIn(), []); return null; }');
  expect(await hasClientSignInRoute(project, '/login')).toBe(false);
});

describe('bounded scan', () => {
  async function incomplete() {
    expect(await hasClientSignInRoute(project, '/login')).toBe(false);
    const result = await validateInstallation('vanilla-js', project, { runBuild: false });
    expect(result.passed).toBe(false);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: 'Client source checks were incomplete; automatic sign-in URL setup will be skipped',
      }),
    );
  }
  it('does not authorize a route from a truncated file set', async () => {
    await file('src/login.ts', login);
    await Promise.all(Array.from({ length: 256 }, (_, i) => file(`src/file-${i}.ts`, 'export {};')));
    await incomplete();
  });
  it('bounds individual file reads', async () => {
    await file('src/main.ts', login + ' '.repeat(256 * 1024));
    await incomplete();
  });
  it('bounds aggregate content, not only individual files', async () => {
    await file('src/login.ts', login);
    await Promise.all(Array.from({ length: 17 }, (_, i) => file(`src/file-${i}.ts`, ' '.repeat(256 * 1024))));
    await incomplete();
  });
});
