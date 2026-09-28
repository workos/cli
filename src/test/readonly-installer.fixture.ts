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

// Intercept before importing CLI modules. Use real Git for inspection/branch
// creation, but never invoke a shell or rely on POSIX PATH executable shims.
const childProcess = await import('node:child_process');
const realExecFileSync = childProcess.execFileSync;
const execFileSync = ((
  file: string,
  args: string[] = [],
  options?: import('node:child_process').ExecFileSyncOptions,
) => {
  record('command', { file, args });
  const readOnly = ['rev-parse', 'status'].includes(args[0]);
  const branch = args.length === 3 && args[0] === 'checkout' && args[1] === '-b';
  if (file !== 'git' || (!readOnly && !branch) || options?.shell) {
    forbidden(`execFileSync ${file} ${args.join(' ')}`)();
  }
  return realExecFileSync(file, args, options);
}) as typeof childProcess.execFileSync;
const execSync = ((command: string, options?: import('node:child_process').ExecSyncOptions) => {
  if (
    !['git rev-parse --abbrev-ref HEAD', 'git rev-parse --is-inside-work-tree', 'git status --porcelain=v1'].includes(
      command,
    )
  )
    forbidden(`execSync ${command}`)();
  return execFileSync('git', command.split(' ').slice(1), options);
}) as typeof childProcess.execSync;
const guardedProcesses = {
  ...childProcess,
  execFileSync,
  execSync,
  exec: forbidden('exec'),
  execFile: forbidden('execFile'),
  spawn: forbidden('spawn'),
  spawnSync: forbidden('spawnSync'),
  fork: forbidden('fork'),
};
mock.module('node:child_process', () => ({ ...guardedProcesses, default: guardedProcesses }));

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

if (process.env.TEST_ENTRY === 'guard-probe') {
  const guarded = await import('node:child_process');
  // These must all throw AND leave evidence even if a caller catches the error.
  const probes = [
    () => guarded.execFileSync('git', ['add', '-A']),
    () => guarded.execFileSync('git', ['commit', '-m', 'forbidden']),
    () => guarded.execFileSync('git', ['push']),
    () => guarded.execFileSync('gh', ['pr', 'create']),
    () => guarded.execSync('git status --porcelain=v1 && git push'),
    () => guarded.exec('git push'),
    () => guarded.execFile('git', ['push']),
    () => guarded.spawn('git', ['push']),
    () => guarded.spawnSync('git', ['push']),
    () => guarded.fork('forbidden.js'),
  ];
  for (const probe of probes) {
    try {
      probe();
    } catch {
      continue;
    }
    throw new Error('Process guard allowed a forbidden call');
  }
} else if (process.env.TEST_ENTRY === 'programmatic') {
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
