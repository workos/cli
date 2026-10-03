import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from './index.js';
import { initializeAgent, runAgent } from '../../lib/agent-interface.js';
import { getOrAskForWorkOSCredentials } from '../../utils/ui-utils.js';
import { autoConfigureWorkOSEnvironment } from '../../lib/workos-management.js';
import type { InstallerOptions } from '../../utils/types.js';

vi.mock('../../lib/agent-interface.js', () => ({ initializeAgent: vi.fn(), runAgent: vi.fn() }));
vi.mock('../../utils/ui-utils.js', () => ({ getOrAskForWorkOSCredentials: vi.fn() }));
vi.mock('../../lib/workos-management.js', () => ({ autoConfigureWorkOSEnvironment: vi.fn() }));
vi.mock('../../lib/skills-assets.js', () => ({ getReference: vi.fn(async () => 'Pinned Ruby reference') }));
vi.mock('../../utils/analytics.js', () => ({ analytics: { capture: vi.fn(), shutdown: vi.fn() } }));

let directory: string;
let options: InstallerOptions;
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Unexpected network');
    }),
  );
  directory = await mkdtemp(join(tmpdir(), 'ruby-integration-'));
  options = { installDir: directory, debug: false, forceInstall: false, local: false, ci: true, skipAuth: true };
  await mkdir(join(directory, 'config'));
  await writeFile(join(directory, 'config/puma.rb'), 'port ENV.fetch("PORT", 4100)');
  vi.mocked(getOrAskForWorkOSCredentials).mockResolvedValue({
    apiKey: 'sk_test_synthetic',
    clientId: 'client_synthetic',
  });
  vi.mocked(runAgent).mockResolvedValue({});
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

describe('real Ruby integration with fake agent and credentials', () => {
  it.each([undefined, 'http://app.fizzy.localhost:3006/workos/callback'])(
    'uses one callback and origin (%s)',
    async (redirectUri) => {
      const callback = redirectUri ?? 'http://localhost:4100/auth/callback';
      const origin = new URL(callback).origin;
      const summary = await run({ ...options, redirectUri });
      const prompt = vi.mocked(runAgent).mock.calls[0][1];
      expect(prompt).toContain(`WORKOS_REDIRECT_URI=${callback}`);
      expect(prompt).toContain(`${origin}/auth/login`);
      expect(prompt).toContain(`${origin}/`);
      expect(summary).toContain(callback);
      expect(summary).toContain('not verified');
      expect(summary).not.toContain('What the agent did');
      expect(autoConfigureWorkOSEnvironment).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'writes selected credentials without putting secrets in the prompt (package.json: %s)',
    async (hasPackage) => {
      if (hasPackage) await writeFile(join(directory, 'package.json'), '{}');
      const file = hasPackage ? '.env.local' : '.env';
      await writeFile(join(directory, file), 'OTHER=preserved\n');
      await run(options);
      const env = await readFile(join(directory, file), 'utf8');
      expect(env).toContain('WORKOS_API_KEY=sk_test_synthetic');
      expect(env).toContain('WORKOS_CLIENT_ID=client_synthetic');
      expect(env).toContain('WORKOS_REDIRECT_URI=http://localhost:4100/auth/callback');
      expect(env).toContain('OTHER=preserved');
      const prompt = vi.mocked(runAgent).mock.calls[0][1];
      expect(prompt).toContain(file);
      expect(prompt).toContain('loaded before WorkOS initialization');
      expect(prompt).not.toContain('sk_test_synthetic');
      expect(await readFile(join(directory, '.gitignore'), 'utf8')).toContain(file);
      expect(initializeAgent).toHaveBeenCalledWith(expect.objectContaining({ workingDirectory: directory }), options);
    },
  );

  it('requires real UI/session integration without choosing account policy', async () => {
    await run(options);
    const prompt = vi.mocked(runAgent).mock.calls[0][1];
    for (const requirement of [
      'visible sign-in',
      'signed-in account',
      'repeat login',
      'existing authorization',
      'account-linking',
      'magic-link',
      'passkey',
      'SDK',
      'protected access',
      'not global provider-session revocation',
    ]) {
      expect(prompt).toContain(requirement);
    }
  });

  it('does not report success on agent failure', async () => {
    vi.mocked(runAgent).mockResolvedValue({ error: 'synthetic failure' });
    await expect(run(options)).rejects.toThrow('synthetic failure');
  });
});
