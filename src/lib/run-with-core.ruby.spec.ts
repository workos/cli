import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runWithCore } from './run-with-core.js';
import { runAgent } from './agent-interface.js';
import { configureAuthkitApplication } from './authkit-application-setup.js';
import { setOutputMode } from '../utils/output.js';

vi.mock('./agent-interface.js', () => ({ initializeAgent: vi.fn(), runAgent: vi.fn(async () => ({})) }));
vi.mock('./skills-assets.js', () => ({ getReference: vi.fn(async () => 'Ruby reference') }));
vi.mock('./authkit-application-setup.js', async (original) => ({
  ...(await original<typeof import('./authkit-application-setup.js')>()),
  configureAuthkitApplication: vi.fn(async (setup) => ({
    ...setup,
    callbackRegistered: true,
    verified: false,
    reason: 'Synthetic pending read-back',
  })),
}));
vi.mock('./credentials.js', () => ({ getAccessToken: vi.fn(() => null), saveCredentials: vi.fn() }));
vi.mock('./config-store.js', () => ({
  getActiveEnvironment: vi.fn(() => null),
  isUnclaimedEnvironment: vi.fn(() => false),
}));
vi.mock('../utils/debug.js', () => ({
  initLogFile: vi.fn(),
  enableDebugLogs: vi.fn(),
  logInfo: vi.fn(),
  logError: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../utils/analytics.js', () => ({
  analytics: {
    setGatewayUrl: vi.fn(),
    capture: vi.fn(),
    configureAuthFromAvailableSources: vi.fn(),
    sessionStart: vi.fn(),
    shutdown: vi.fn(),
    setTag: vi.fn(),
  },
}));
vi.mock('./post-install.js', () => ({
  detectChanges: vi.fn(() => ({ hasChanges: false, files: [] })),
  stageAndCommit: vi.fn(),
  pushBranch: vi.fn(),
  createPullRequest: vi.fn(),
}));
vi.mock('../utils/git-utils.js', () => ({
  getCurrentBranch: vi.fn(() => 'synthetic'),
  isProtectedBranch: vi.fn(() => false),
  createBranch: vi.fn(),
  branchExists: vi.fn(() => false),
}));
vi.mock('../utils/ui-utils.js', () => ({
  getPackageDotJson: vi.fn(),
  isInGitRepo: vi.fn(() => false),
  getUncommittedOrUntrackedFiles: vi.fn(() => []),
  getOrAskForWorkOSCredentials: vi.fn(async (options) => ({ apiKey: options.apiKey, clientId: options.clientId })),
}));

let directory: string;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setOutputMode('human');
  if (directory) await rm(directory, { recursive: true, force: true });
});

it.each([undefined, 'http://app.fizzy.localhost:3006/auth/callback'])(
  'runs Ruby before common URL setup and consistently reports its origin (%s)',
  async (redirectUri) => {
    vi.clearAllMocks();
    const callback = redirectUri ?? 'http://localhost:4100/auth/callback';
    const origin = new URL(callback).origin;
    directory = await mkdtemp(join(tmpdir(), 'ruby-orchestration-'));
    await mkdir(join(directory, 'config'));
    await writeFile(join(directory, 'Gemfile'), 'gem "rails"');
    await writeFile(join(directory, 'config/puma.rb'), 'port 4100');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network');
      }),
    );
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    setOutputMode('json');
    await runWithCore({
      installDir: directory,
      integration: 'ruby',
      apiKey: 'sk_test_synthetic',
      clientId: 'client_synthetic',
      redirectUri,
      ci: true,
      debug: false,
      local: false,
      forceInstall: false,
      skipAuth: true,
      noBranch: true,
      noCommit: true,
      noGitCheck: true,
    });
    expect(runAgent).toHaveBeenCalledOnce();
    expect(configureAuthkitApplication).toHaveBeenCalledOnce();
    expect(vi.mocked(runAgent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(configureAuthkitApplication).mock.invocationCallOrder[0],
    );
    expect(configureAuthkitApplication).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: callback,
        corsOrigin: origin,
        signOutUri: `${origin}/`,
        initiateLoginUri: `${origin}/auth/login`,
      }),
      'client_synthetic',
      'sk_test_synthetic',
    );
    expect(vi.mocked(runAgent).mock.calls[0][1]).toContain(`WORKOS_REDIRECT_URI=${callback}`);
    expect(output.join('')).toContain(`Open ${origin} to test authentication`);
    expect(output.join('')).toContain('Synthetic pending read-back');
    expect(output.join('')).toContain('startup not verified');
    expect(fetch).not.toHaveBeenCalled();
  },
);
