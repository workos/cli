// Bun subprocess fixture: real parser/orchestration, fake external boundaries.
// @ts-expect-error This subprocess runs on Bun; the project typechecks against Node types.
import { mock } from 'bun:test';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InstallerOptions } from '../utils/types.js';

const record = (kind: string, value: unknown) =>
  appendFileSync(process.env.TEST_EVIDENCE!, `${JSON.stringify({ kind, value })}\n`);
const forbidden =
  (name: string) =>
  (..._args: unknown[]): never => {
    record('forbidden', name);
    throw new Error(`Forbidden external call: ${name}`);
  };

// Block both native keychain backends BEFORE loading any CLI modules.
mock.module('@napi-rs/keyring', () => ({
  Entry: class {
    constructor() {
      forbidden('native keyring')();
    }
  },
}));
mock.module('../lib/darwin-keychain.js', () => ({
  DarwinSecurityEntry: class {
    constructor() {
      forbidden('darwin keychain')();
    }
  },
}));
await import('./force-insecure-storage.js');
globalThis.fetch = forbidden('fetch');
mock.module('@anthropic-ai/sdk', () => ({
  default: class {
    constructor() {
      forbidden('Anthropic')();
    }
  },
}));
mock.module('@anthropic-ai/claude-agent-sdk', () => ({ query: forbidden('agent SDK') }));
mock.module('../lib/credential-proxy.js', () => ({ startCredentialProxy: forbidden('credential proxy') }));
mock.module('../lib/version-check.js', () => ({ checkForUpdates: async () => {} }));
mock.module('../lib/resolve-install-credentials.js', () => ({
  resolveInstallCredentials: async () => {},
  maybePickInstallEnvironment: async () => {},
  resolveStagingCredentials: forbidden('staging credentials'),
}));
mock.module('../commands/setup.js', () => ({ maybeRunSetupAfter: async () => {} }));
const credentials = await import('../lib/credentials.js');
mock.module('../lib/credentials.js', () => ({ ...credentials, getAccessToken: () => 'offline-test-token' }));
const application = await import('../lib/authkit-application-setup.js');
mock.module('../lib/authkit-application-setup.js', () => ({
  ...application,
  configureAuthkitApplication: async (setup: object) => ({
    ...setup,
    verified: false,
    reason: 'Offline fixture: browser flows not tested.',
  }),
}));
const config = {
  metadata: { integration: 'vanilla-js', language: 'javascript', docsUrl: 'https://workos.com/docs' },
  environment: { requiresApiKey: false },
  ui: {},
};
mock.module('../lib/registry.js', () => ({
  getRegistry: async () => ({
    detectionOrder: () => [config],
    get: () => ({
      config,
      run: async (options: InstallerOptions) => {
        record('agent-options', {
          noCommit: options.noCommit,
          createPr: options.createPr,
          installDir: options.installDir,
        });
        if (process.env.TEST_AGENT === 'fail') throw new Error('Fake installation failed');
        writeFileSync(join(options.installDir, 'generated.ts'), 'export const authkit = true;\n');
        writeFileSync(join(options.installDir, 'tracked.ts'), 'export const modified = true;\n');
        options.emitter?.emit('validation:start', { framework: 'vanilla-js' });
        options.emitter?.emit('validation:complete', { passed: true, issueCount: 0, durationMs: 1 });
        return 'Offline installation completed';
      },
    }),
  }),
}));

// Human parser paths still use the real CLI adapter; answer only its expected
// pre-install questions. Any commit/PR question is a hard test failure.
if (process.env.TEST_HUMAN === '1') {
  Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stderr, 'isTTY', { value: true, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: 79, configurable: true });
  const { default: ui, CANCEL } = await import('../utils/ui.js');
  ui.confirm = async ({ message }) => {
    record('prompt', message);
    if (!['Run the AuthKit installer?', 'Continue anyway?'].includes(message)) forbidden(message)();
    return process.env.TEST_CANCEL !== '1' || message !== 'Continue anyway?';
  };
  ui.select = async ({ message, signal }) => {
    if (signal?.aborted) return CANCEL;
    record('prompt', message);
    if (!message.includes('Create a feature branch?')) forbidden(message)();
    return 'create' as never;
  };
}

if (process.env.TEST_ENTRY === 'programmatic') {
  const { setOutputMode } = await import('../utils/output.js');
  setOutputMode('json');
  const { runWithCore } = await import('../lib/run-with-core.js');
  await runWithCore({
    installDir: process.cwd(),
    skipAuth: true,
    apiKey: 'sk_test_offline',
    clientId: 'client_offline',
    noGitCheck: true,
    noBranch: true,
    noCommit: false,
    createPr: true,
  } as InstallerOptions);
} else {
  await import('../bin.js');
}
