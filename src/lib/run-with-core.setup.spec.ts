import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { InstallerOptions } from '../utils/types.js';
import { configureInstallEnvironment } from './run-with-core.js';
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
