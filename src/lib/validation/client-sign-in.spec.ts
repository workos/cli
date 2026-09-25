import { describe, expect, it } from 'vitest';
import { hasClientSignInBehavior } from './client-sign-in.js';

describe('mounted route component', () => {
  it.each([
    'function Login() { useEffect(() => { signIn(); }, []); return null; }',
    'function Login() { useEffect(() => { if (isLoading) return; signIn(); }, [isLoading]); return null; }',
    'function Login() { useEffect(() => { if (loading) { return; } void signIn(); }, [loading]); return null; }',
    'const Login = () => { React.useEffect(() => { if (!isLoading) signIn(); }, [isLoading]); return null; };',
    'const Login = function() { useEffect(() => { if (!loading) void authkit.signIn(); }, [loading]); return null; };',
  ])('accepts supported component definitions and readiness guards: %s', (component) => {
    expect(hasClientSignInBehavior(`${component} const routes = [{path: '/login', Component: Login}];`, '/login')).toBe(
      true,
    );
  });

  it.each([
    'function Login() { return <button onClick={() => signIn()}>Login</button>; }',
    'function Login() { function unused() { useEffect(() => signIn(), []); } return null; }',
    'function Login() { function unused() { signIn(); } useEffect(() => {}, []); return null; }',
    'function Login() { useEffect(() => { function unused() { signIn(); } }, []); return null; }',
    'function Login() { useEffect(() => { return; signIn(); }, []); return null; }',
    'function Login() { return null; useEffect(() => signIn(), []); }',
    'function Login() { useEffect(() => { if (false) signIn(); }, []); return null; }',
    'function Login() { useEffect(() => { /* signIn(); */ }, []); return null; }',
    'function Login() { return null; } function Unrelated() { useEffect(() => signIn(), []); }',
    'const Login = memo(() => { useEffect(() => signIn(), []); return null; });',
    'import Login from "./missing"; function Unrelated() { useEffect(() => signIn(), []); }',
  ])('rejects a route component without a direct sign-in effect: %s', (component) => {
    expect(
      hasClientSignInBehavior(`${component} const routes = [{path: '/login', element: <Login />}];`, '/login'),
    ).toBe(false);
  });

  it.each([
    'function App(Login) { return <Route path="/login" element={<Login />} />; }',
    'function App({ Login }) { return <Route path="/login" element={<Login />} />; }',
    'function App() { const Login = () => null; return <Route path="/login" element={<Login />} />; }',
    'function App() { if (true) { var Login = () => null; } return <Route path="/login" element={<Login />} />; }',
    'try { fail(); } catch (Login) { const route = <Route path="/login" element={<Login />} />; }',
    'for (const Login of pages) { const route = <Route path="/login" element={<Login />} />; }',
    'const route = <Route path="/login" element={<h1>Login</h1>} />;',
    'const route = <Route path="/other" element={<Login />} />;',
    'const route = <Route path="/login" element={<Login />} {...overrides} />;',
    "const route = {path: '/login', Component: Login, ...overrides};",
    "const route = {path: '/login', element: <h1>Login</h1>, Component: Login};",
    'Login = () => null; const route = <Route path="/login" element={<Login />} />;',
    '// <Route path="/login" element={<Login />} />',
  ])('does not use an unrelated or shadowed Login binding: %s', (route) => {
    expect(
      hasClientSignInBehavior(`function Login() { useEffect(() => signIn(), []); return null; } ${route}`, '/login'),
    ).toBe(false);
  });

  it('resolves a component declared in the route module’s local scope', () => {
    expect(
      hasClientSignInBehavior(
        `function App() {
      const Login = () => { useEffect(() => signIn(), []); return null; };
      return <Route path="/login" element={<Login />} />;
    }`,
        '/login',
      ),
    ).toBe(true);
  });

  it.each([
    '<Route path="/login" element={<Login />} />',
    "const routes = [{ path: '/login', element: <Login /> }];",
    "const routes = [{ path: '/login', Component: Login }];",
    "const routes = [{ path: '/login', component: Login }];",
  ])('accepts the effect belonging to %s without a second pathname guard', (route) => {
    expect(
      hasClientSignInBehavior(
        `
      function Login() { useEffect(() => signIn(), []); return null; }
      ${route.startsWith('<') ? `function App() { return ${route}; }` : route}
    `,
        '/login',
      ),
    ).toBe(true);
  });
});

describe('sign-in belongs to the matching pathname branch', () => {
  it.each([
    "if (window.location.pathname === '/login') signIn();",
    "if ('/login' === location.pathname) { void client.signIn(); }",
    "const path = window.location.pathname; if (path === '/login') { await authkit.signIn(); }",
    "function App() { useEffect(() => { if (!isLoading && window.location.pathname === '/login') { void signIn(); } }, [isLoading, signIn]); return null; }",
    "function Login() { React.useEffect(() => { if (window.location.pathname === '/login') { signIn(); } }, []); return <span>Signing in</span>; }",
    '<script type="module">if (window.location.pathname === "/login") authkit.signIn();</script>',
  ])('accepts route-bound startup behavior: %s', (source) => {
    expect(hasClientSignInBehavior(source, '/login')).toBe(true);
  });

  it.each([
    '<Route path="/login" element={<h1>Hello</h1>} />; const button = <button onClick={() => signIn()}>Sign in</button>;',
    "if (window.location.pathname === '/login') renderPage(); signIn();",
    "if (window.location.pathname === '/login') renderPage(); else signIn();",
    "if (window.location.pathname === '/logout') signIn();",
    "if (window.location.pathname !== '/login') signIn();",
    "if (window.location.pathname === '/login' || debug) signIn();",
    "if (window.location.pathname === '/login' && false) signIn();",
    "if (window.location.pathname === '/login') { button.onclick = () => signIn(); }",
    "if (window.location.pathname === '/login') { function click() { signIn(); } }",
    "if (window.location.pathname === '/login') { return; signIn(); }",
    "function onClick() { if (window.location.pathname === '/login') signIn(); }",
    "// if (window.location.pathname === '/login') signIn();",
    `const example = "if (window.location.pathname === '/login') signIn();";`,
    "const pathname = '/login'; if (window.location[pathname] === '/login') signIn();",
    "not valid JavaScript if (window.location.pathname === '/login') signIn();",
  ])('rejects unrelated, unreachable or click-only calls: %s', (source) => {
    expect(hasClientSignInBehavior(source, '/login')).toBe(false);
  });

  it('requires startup behavior for a static login page too', () => {
    expect(hasClientSignInBehavior('<script>authkit.signIn();</script>', '/login', true)).toBe(true);
    expect(hasClientSignInBehavior('<script>button.onclick = () => authkit.signIn();</script>', '/login', true)).toBe(
      false,
    );
    expect(hasClientSignInBehavior('<script>// authkit.signIn()</script>', '/login', true)).toBe(false);
  });
});
