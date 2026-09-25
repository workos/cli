import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InstallerOptions } from '../utils/types.js';
import {
  configureInstallEnvironment,
  configureOtherApplicationUrls,
  NO_SIGN_IN_ROUTE_REASON,
  reportAppUrlSetup,
} from './run-with-core.js';
import { configureAuthkitApplication } from './authkit-application-setup.js';
import { InstallDeclinedError } from './installer-errors.js';

vi.mock('./authkit-application-setup.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./authkit-application-setup.js')>()),
  configureAuthkitApplication: vi.fn(),
}));
import { createInstallerEventEmitter } from './events.js';
import { readProjectEnvCredentials } from './project-env.js';

let directory: string;
let options: InstallerOptions;
const fetchSpy = vi.fn();

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'install-setup-'));
  options = {
    installDir: directory,
    router: 'app',
    debug: false,
    forceInstall: false,
    local: false,
    ci: true,
    skipAuth: true,
  };
  fetchSpy.mockReset().mockResolvedValue(new Response('{}', { status: 201 }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe('Next.js environment preparation', () => {
  it.each([true, false])(
    'does not mutate the API-key environment for a mixed pair (explicit key: %s)',
    async (explicitKey) => {
      await writeFile(join(directory, '.env.local'), 'WORKOS_CLIENT_ID=client_environment_b\n');
      if (!explicitKey) await writeFile(join(directory, '.env'), 'WORKOS_API_KEY=sk_test_environment_a\n');
      const project = readProjectEnvCredentials(directory);
      await configureInstallEnvironment({
        options,
        integration: 'nextjs',
        credentials: {
          apiKey: explicitKey ? 'sk_test_environment_a' : project.apiKey!,
          clientId: project.clientId!,
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
      const env = await readFile(join(directory, '.env.local'), 'utf8');
      expect(env).toContain('WORKOS_CLIENT_ID=client_environment_b');
    },
  );

  it.each(['pages', 'src/pages'])('declines %s projects before writing credentials or settings', async (pages) => {
    await mkdir(join(directory, pages), { recursive: true });
    await writeFile(join(directory, pages, '_app.tsx'), 'export default function App() {}');
    await expect(
      configureInstallEnvironment({
        options: { ...options, router: undefined },
        integration: 'nextjs',
        credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      }),
    ).rejects.toMatchObject({ code: 'unsupported_nextjs_router' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(readFile(join(directory, '.env.local'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects runtime Pages selection before writing credentials or making API calls', async () => {
    const runtimeOptions = JSON.parse(JSON.stringify({ ...options, router: 'pages' }));
    await expect(
      configureInstallEnvironment({
        options: runtimeOptions,
        integration: 'nextjs',
        credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      }),
    ).rejects.toMatchObject({ code: 'unsupported_nextjs_router' });
    expect(fetchSpy).not.toHaveBeenCalled();
    await expect(readFile(join(directory, '.env.local'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not mutate the state machine options while detecting the router', async () => {
    await mkdir(join(directory, 'app'), { recursive: true });
    await writeFile(join(directory, 'app/layout.tsx'), 'export default function Layout() {}');
    const inputOptions = Object.freeze({ ...options, router: undefined });
    await configureInstallEnvironment({
      options: inputOptions,
      integration: 'nextjs',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
    });
    expect(inputOptions.router).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('dashboard checklist reporting', () => {
  const record = () => {
    const emitter = createInstallerEventEmitter();
    const events: string[] = [];
    for (const name of ['config:step', 'app-urls:step'] as const) {
      emitter.on(name, ({ step, status, detail }) =>
        events.push(`${name} ${step} ${status}${detail ? ` (${detail})` : ''}`),
      );
    }
    return { emitter, events };
  };

  it('reports only the environment variables for Next.js, whose URLs are set after the agent', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'nextjs',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    expect(events).toEqual(['config:step env-vars started', 'config:step env-vars done']);
  });

  it('defers React Router URL events until after the agent', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'react-router',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    expect(events).toEqual(['config:step env-vars started', 'config:step env-vars done']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('defers URL writes for other server-side SDKs', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'sveltekit',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.some((event) => event.includes('redirect-uri'))).toBe(false);
    expect(events).toContain('config:step env-vars done');
  });

  it.each(['sveltekit', 'go'])('defers production URL handling for %s', async (integration) => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration,
      credentials: { apiKey: 'sk_live_a', clientId: 'client_a' },
      emitter,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events.every((event) => event.includes('env-vars'))).toBe(true);
  });

  it('defers non-JavaScript URLs without writing .env.local', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'ruby',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(events.some((event) => event.includes('env-vars'))).toBe(false);
    await expect(readFile(join(directory, '.env.local'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes the client ID and callback under the Vite prefix for a client-only app', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ devDependencies: { vite: '^6.0.0' } }));
    await configureInstallEnvironment({
      options,
      integration: 'react',
      credentials: { clientId: 'client_a' },
    });
    const env = await readFile(join(directory, '.env.local'), 'utf8');
    expect(env).toContain('VITE_WORKOS_CLIENT_ID=client_a');
    expect(env).toContain('VITE_WORKOS_REDIRECT_URI=http://localhost:5173/callback');
    expect(env).toContain('WORKOS_REDIRECT_URI=http://localhost:5173/callback');
  });

  it('writes no prefixed vars for a server SDK', async () => {
    await writeFile(join(directory, 'package.json'), JSON.stringify({ devDependencies: { vite: '^6.0.0' } }));
    await configureInstallEnvironment({
      options,
      integration: 'react-router',
      credentials: { clientId: 'client_a' },
    });
    expect(await readFile(join(directory, '.env.local'), 'utf8')).not.toContain('VITE_WORKOS');
  });

  it.each(['react', 'vanilla-js'] as const)(
    'defers callback and CORS writes for the client-only %s SDK',
    async (integration) => {
      await configureInstallEnvironment({
        options,
        integration,
        credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('does not prematurely skip client-only URLs without an API key', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'react',
      credentials: { clientId: 'client_a' },
      emitter,
    });
    expect(events).toEqual(['config:step env-vars started', 'config:step env-vars done']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not prematurely skip server URLs without an API key', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'react-router',
      credentials: { clientId: 'client_a' },
      emitter,
    });
    expect(events).toEqual(['config:step env-vars started', 'config:step env-vars done']);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const setup = { clientId: 'client_a', redirectUri: 'x', signOutUri: 'y', initiateLoginUri: 'z' };

  it('ticks all three app URLs when the setup is verified', async () => {
    const { emitter, events } = record();
    await reportAppUrlSetup(emitter, async () => ({ ...setup, verified: true, callbackRegistered: true }));
    expect(events.slice(3)).toEqual([
      'app-urls:step redirect-uri done',
      'app-urls:step initiate-login-uri done',
      'app-urls:step sign-out-uri done',
    ]);
  });

  it.each([true, false])('reports CORS independently of pending dashboard settings (%s)', async (corsRegistered) => {
    const { emitter, events } = record();
    await reportAppUrlSetup(
      emitter,
      async () => ({
        ...setup,
        corsOrigin: 'http://localhost:5173',
        corsRegistered,
        callbackRegistered: true,
        verified: false,
        reason: 'Manual setup needed.',
      }),
      { includeCors: true },
    );
    expect(events).toContain('app-urls:step redirect-uri done');
    expect(events).toContain('app-urls:step cors-origin started');
    expect(events).toContain(
      corsRegistered ? 'app-urls:step cors-origin done' : 'app-urls:step cors-origin skipped (Manual setup needed.)',
    );
    expect(events).toContain('app-urls:step sign-out-uri skipped (Manual setup needed.)');
  });

  it('reports saved sign-out independently of pending client login verification', async () => {
    const { emitter, events } = record();
    const { initiateLoginUri: _omitted, ...withoutSignIn } = setup;
    await reportAppUrlSetup(emitter, async () => ({
      ...withoutSignIn,
      verified: false,
      callbackRegistered: true,
      signOutRegistered: true,
      initiateLoginReason: 'Check /login in the browser.',
      reason: 'Check /login in the browser.',
    }));
    expect(events).toContain('app-urls:step sign-out-uri done');
    expect(events).toContain('app-urls:step initiate-login-uri skipped (Check /login in the browser.)');
  });

  it('flags the unverified URLs with the setup reason', async () => {
    const { emitter, events } = record();
    const result = await reportAppUrlSetup(emitter, async () => ({
      ...setup,
      verified: false,
      callbackRegistered: true,
      reason: 'Sign in to manage those settings.',
    }));
    expect(result.verified).toBe(false);
    expect(events.slice(3)).toEqual([
      'app-urls:step redirect-uri done',
      'app-urls:step initiate-login-uri skipped (Sign in to manage those settings.)',
      'app-urls:step sign-out-uri skipped (Sign in to manage those settings.)',
    ]);
  });

  it('reports only the other two URLs when the environment step already reported the callback', async () => {
    const { emitter, events } = record();
    const { initiateLoginUri: _omitted, ...withoutSignIn } = setup;
    await reportAppUrlSetup(
      emitter,
      async () => ({
        ...withoutSignIn,
        initiateLoginReason: NO_SIGN_IN_ROUTE_REASON,
        verified: true,
        callbackRegistered: true,
      }),
      { includeRedirect: false },
    );
    expect(events).toEqual([
      'app-urls:step initiate-login-uri started',
      'app-urls:step sign-out-uri started',
      `app-urls:step initiate-login-uri skipped (${NO_SIGN_IN_ROUTE_REASON})`,
      'app-urls:step sign-out-uri done',
    ]);
  });

  it('leaves the items running when setup throws, so the failed install fails them', async () => {
    const { emitter, events } = record();
    await expect(
      reportAppUrlSetup(emitter, async () => {
        throw new Error('Callback URL is not registered or verified.');
      }),
    ).rejects.toThrow('not registered');
    expect(events).toEqual([
      'app-urls:step redirect-uri started',
      'app-urls:step initiate-login-uri started',
      'app-urls:step sign-out-uri started',
    ]);
  });
});

describe('application URLs for SDKs other than Next.js', () => {
  beforeEach(() => {
    vi.mocked(configureAuthkitApplication).mockReset();
    vi.mocked(configureAuthkitApplication).mockImplementation(async (setup) => ({
      ...setup,
      verified: true,
      callbackRegistered: true,
    }));
  });

  it("saves a server SDK's fixed sign-in route and the origin as the sign-out URI", async () => {
    const result = await configureOtherApplicationUrls(
      { options, integration: 'go', emitter: createInstallerEventEmitter() },
      'client_a',
      'sk_test_a',
    );
    expect(vi.mocked(configureAuthkitApplication)).toHaveBeenCalledWith(
      {
        clientId: 'client_a',
        redirectUri: 'http://localhost:8080/auth/callback',
        signOutUri: 'http://localhost:8080/',
        corsOrigin: 'http://localhost:8080',
        initiateLoginUri: 'http://localhost:8080/auth/login',
        verified: false,
      },
      'client_a',
      'sk_test_a',
    );
    expect(result?.verified).toBe(true);
  });

  it("saves a server SDK's documented route without scanning its source", async () => {
    await configureOtherApplicationUrls(
      { options, integration: 'react-router', emitter: createInstallerEventEmitter() },
      'client_a',
      'sk_test_a',
    );
    expect(vi.mocked(configureAuthkitApplication).mock.calls[0][0].initiateLoginUri).toBe(
      'http://localhost:5173/login',
    );
  });

  it.each(['react', 'vanilla-js'])(
    'leaves %s initiate login unchanged even when source looks correct',
    async (integration) => {
      await mkdir(join(directory, 'src'), { recursive: true });
      await writeFile(join(directory, 'package.json'), '{"dependencies":{"@workos-inc/authkit-react":"1"}}');
      await writeFile(join(directory, '.env.local'), 'VITE_WORKOS_CLIENT_ID=client_a\n');
      await writeFile(
        join(directory, 'src/main.tsx'),
        "import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react';\n<AuthKitProvider><App /></AuthKitProvider>;\n",
      );
      await writeFile(
        join(directory, 'src/App.tsx'),
        "if (window.location.pathname === '/login') signIn();\nconst { signIn } = useAuth();\n",
      );
      await writeFile(
        join(directory, 'src/config.ts'),
        'export const redirectUri = import.meta.env.VITE_WORKOS_REDIRECT_URI;\n',
      );
      await configureOtherApplicationUrls(
        { options, integration, emitter: createInstallerEventEmitter() },
        'client_a',
        'sk_test_a',
      );
      expect(vi.mocked(configureAuthkitApplication).mock.calls[0][0]).not.toHaveProperty('initiateLoginUri');
      expect(vi.mocked(configureAuthkitApplication).mock.calls[0][0]).toMatchObject({
        redirectUri: 'http://localhost:5173/callback',
        corsOrigin: 'http://localhost:5173',
        signOutUri: 'http://localhost:5173/',
        initiateLoginReason: expect.stringContaining('requires browser verification'),
      });
    },
  );

  it('does not save a Vite /login route the app only links to', async () => {
    await mkdir(join(directory, 'src'), { recursive: true });
    await writeFile(join(directory, 'src/App.tsx'), '<a href="/login">Sign in</a>');
    await configureOtherApplicationUrls(
      { options, integration: 'react', emitter: createInstallerEventEmitter() },
      'client_a',
      'sk_test_a',
    );
    expect(vi.mocked(configureAuthkitApplication).mock.calls[0][0]).not.toHaveProperty('initiateLoginUri');
  });

  it('reports client route verification as pending, not a missing route', async () => {
    const emitter = createInstallerEventEmitter();
    const events: string[] = [];
    emitter.on('app-urls:step', ({ step, status, detail }) => events.push(`${step} ${status} ${detail ?? ''}`.trim()));
    await configureOtherApplicationUrls({ options, integration: 'react', emitter }, 'client_a', 'sk_test_a');
    expect(vi.mocked(configureAuthkitApplication).mock.calls[0][0]).not.toHaveProperty('initiateLoginUri');
    expect(events).toContain(
      'initiate-login-uri skipped Client-side /login requires browser verification. Confirm it starts sign-in without a click, then set the Initiate login URI in the WorkOS dashboard. The existing setting was left unchanged.',
    );
  });

  it('uses the explicit callback origin for CORS as well as sign-out', async () => {
    await configureOtherApplicationUrls(
      {
        options: { ...options, redirectUri: 'https://dev.example.com/callback' },
        integration: 'react',
        emitter: createInstallerEventEmitter(),
      },
      'client_a',
      'sk_test_a',
    );
    expect(vi.mocked(configureAuthkitApplication).mock.calls[0][0]).toMatchObject({
      redirectUri: 'https://dev.example.com/callback',
      corsOrigin: 'https://dev.example.com',
      signOutUri: 'https://dev.example.com/',
    });
  });

  it('still rejects a callback that collides with the client login route', async () => {
    await expect(
      configureOtherApplicationUrls(
        {
          options: { ...options, redirectUri: 'http://localhost:5173/login' },
          integration: 'react',
          emitter: createInstallerEventEmitter(),
        },
        'client_a',
        'sk_test_a',
      ),
    ).rejects.toThrow('The OAuth callback cannot use /login');
    expect(configureAuthkitApplication).not.toHaveBeenCalled();
  });

  it('rejects an unusable callback URL before any setup', async () => {
    const emitter = createInstallerEventEmitter();
    const events: string[] = [];
    emitter.on('app-urls:step', ({ step, status }) => events.push(`${step} ${status}`));
    await expect(
      configureOtherApplicationUrls(
        { options: { ...options, redirectUri: 'ftp://localhost/callback' }, integration: 'go', emitter },
        'client_a',
      ),
    ).rejects.toThrow('HTTP(S)');
    expect(events).toEqual([]);
    expect(configureAuthkitApplication).not.toHaveBeenCalled();
  });

  it('fails the install if the deferred callback cannot be registered', async () => {
    vi.mocked(configureAuthkitApplication).mockRejectedValue(
      new InstallDeclinedError('Automatic URL setup is restricted to sandbox environments.', 'callback_unregistered'),
    );
    const emitter = createInstallerEventEmitter();
    const events: string[] = [];
    emitter.on('app-urls:step', ({ step, status, detail }) => events.push(`${step} ${status} ${detail ?? ''}`.trim()));
    await expect(configureOtherApplicationUrls({ options, integration: 'go', emitter }, 'client_a')).rejects.toThrow(
      'restricted to sandbox',
    );
    expect(events).toContain('redirect-uri started');
    expect(events).toContain('cors-origin started');
    expect(events.some((event) => event.includes('done'))).toBe(false);
  });
});
