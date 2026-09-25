import { describe, expect, it } from 'vitest';
import { hasClientSignInBehavior } from './client-sign-in.js';

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
