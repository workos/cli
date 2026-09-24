import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InstallerOptions } from '../utils/types.js';
import { configureInstallEnvironment, reportAppUrlSetup } from './run-with-core.js';
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

  it('reports the redirect URI and CORS origin as they land for React Router', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'react-router',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    expect(events).toEqual([
      'config:step env-vars started',
      'config:step redirect-uri started',
      'config:step cors-origin started',
      'config:step redirect-uri done',
      'config:step cors-origin done',
      'config:step env-vars done',
    ]);
  });

  const registeredPaths = () => fetchSpy.mock.calls.map(([url]) => new URL(String(url)).pathname);

  it('registers the redirect URI and CORS origin for every server-side SDK', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'sveltekit',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    expect(registeredPaths()).toEqual(
      expect.arrayContaining(['/user_management/redirect_uris', '/user_management/cors_origins']),
    );
    expect(events).toContain('config:step redirect-uri done');
    expect(events).toContain('config:step env-vars done');
  });

  it('registers the URLs for a non-JavaScript SDK without writing .env.local', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'ruby',
      credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      emitter,
    });
    const redirect = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/user_management/redirect_uris'));
    expect(JSON.parse(String(redirect?.[1]?.body))).toEqual({ uri: 'http://localhost:3000/auth/callback' });
    expect(events).toContain('config:step redirect-uri done');
    expect(events.some((event) => event.includes('env-vars'))).toBe(false);
    await expect(readFile(join(directory, '.env.local'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['react', 'vanilla-js'] as const)(
    'registers the Vite callback and CORS origin for the client-only %s SDK',
    async (integration) => {
      await configureInstallEnvironment({
        options,
        integration,
        credentials: { apiKey: 'sk_test_a', clientId: 'client_a' },
      });
      const bodyFor = (path: string) =>
        JSON.parse(String(fetchSpy.mock.calls.find(([url]) => String(url).endsWith(path))?.[1]?.body));
      expect(bodyFor('/user_management/redirect_uris')).toEqual({ uri: 'http://localhost:5173/callback' });
      expect(bodyFor('/user_management/cors_origins')).toEqual({ origin: 'http://localhost:5173' });
    },
  );

  it('says why a client-only SDK without an API key has no URLs registered', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'react',
      credentials: { clientId: 'client_a' },
      emitter,
    });
    expect(events).toContain('config:step redirect-uri skipped (No API key was available for this install.)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says why the redirect URI and CORS origin were not set without an API key', async () => {
    const { emitter, events } = record();
    await configureInstallEnvironment({
      options,
      integration: 'react-router',
      credentials: { clientId: 'client_a' },
      emitter,
    });
    expect(events).toContain('config:step redirect-uri skipped (No API key was available for this install.)');
    expect(events).toContain('config:step cors-origin skipped (No API key was available for this install.)');
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
