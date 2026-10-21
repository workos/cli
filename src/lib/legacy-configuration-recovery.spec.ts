import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InstallerOptions } from '../utils/types.js';

vi.mock('./skills-assets.js', () => ({ getReference: vi.fn(async () => 'Offline instructions') }));
vi.mock('./agent-interface.js', () => ({ initializeAgent: vi.fn(), runAgent: vi.fn(async () => ({})) }));
vi.mock('./ensure-auth.js', () => ({
  ensureAuthenticated: vi.fn(async () => ({ authenticated: true, loginTriggered: false, tokenRefreshed: false })),
}));
vi.mock('./credentials.js', () => ({ getAccessToken: vi.fn(() => 'fake-token') }));
vi.mock('./staging-api.js', () => ({
  fetchStagingCredentials: vi.fn(async () => ({ apiKey: 'sk_test_fake_recovered', clientId: 'client_fake' })),
}));
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: vi.fn(() => null),
  isUnclaimedEnvironment: vi.fn(() => false),
}));
vi.mock('../utils/ui-utils.js', () => ({
  getOrAskForWorkOSCredentials: vi.fn(async () => ({ apiKey: 'sk_test_fake_rejected', clientId: 'client_fake' })),
}));
vi.mock('../utils/analytics.js', () => ({ analytics: { capture: vi.fn(), setTag: vi.fn(), shutdown: vi.fn() } }));

import ui from '../utils/ui.js';
import { initializeAgent, runAgent } from './agent-interface.js';
import { run as go } from '../integrations/go/index.js';
import { run as dotnet } from '../integrations/dotnet/index.js';
import { setInteractionMode, resetInteractionModeForTests } from '../utils/interaction-mode.js';
import { setOutputMode } from '../utils/output.js';

const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
let directory: string;
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(join(tmpdir(), 'legacy-recovery-'));
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
  setInteractionMode({ mode: 'human', source: 'flag' });
  setOutputMode('human');
  vi.spyOn(ui, 'select').mockResolvedValue('retry');
  vi.spyOn(ui, 'rows').mockImplementation(() => {});
  for (const method of ['info', 'warn', 'step', 'success'] as const)
    vi.spyOn(ui.log, method).mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: RequestInit) =>
      Response.json(
        {},
        {
          status: (init.headers as Record<string, string>).Authorization.includes('rejected') ? 401 : 201,
        },
      ),
    ),
  );
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  resetInteractionModeForTests();
  await rm(directory, { recursive: true, force: true });
});

describe('legacy pre-agent callers', () => {
  it.each([
    ['go', go],
    ['dotnet', dotnet],
  ] as const)('%s forwards the accepted same-target pair after real REST recovery', async (name, run) => {
    const options: InstallerOptions = {
      installDir: directory,
      debug: false,
      forceInstall: false,
      local: false,
      ci: false,
      noValidate: true,
    };
    const summary = await run(options);
    const pair = { apiKey: 'sk_test_fake_recovered', clientId: 'client_fake' };
    expect(options).toMatchObject(pair);
    expect(initializeAgent).toHaveBeenCalledWith(
      expect.objectContaining({ workOSApiKey: pair.apiKey }),
      expect.objectContaining(pair),
    );
    expect(vi.mocked(runAgent).mock.calls[0][2]).toMatchObject(pair);
    expect(vi.mocked(runAgent).mock.calls[0][1]).not.toContain(pair.apiKey);
    expect(ui.select).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    expect(summary).not.toContain(pair.apiKey);
    if (name === 'go') {
      const env = await readFile(join(directory, '.env'), 'utf8');
      expect(env).toContain(`WORKOS_API_KEY=${pair.apiKey}`);
      expect(env).toContain(`WORKOS_CLIENT_ID=${pair.clientId}`);
      expect(env).not.toContain('fake_rejected');
    }
  });
});
