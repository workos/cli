/** Offline synthetic installer only. Driven by prompt-ownership-pty.py. */
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';

const [mode, scenario, evidence] = process.argv.slice(2);
assert(['cli', 'tui'].includes(mode));
assert(['answers', 'cancel', 'stop'].includes(scenario));
assert(evidence && process.stdin.isTTY && process.stdout.isTTY);

// Fail closed if a future adapter change tries to access credentials/network.
const forbidden = () => {
  throw new Error('Credential/network access is forbidden in this fixture');
};
mock.module('../src/lib/config-store.js', () => ({
  getActiveEnvironment: forbidden,
  isUnclaimedEnvironment: forbidden,
  profileEnvironmentLabel: forbidden,
}));
mock.module('@napi-rs/keyring', () => ({
  Entry: class {
    constructor() {
      forbidden();
    }
  },
}));
mock.module('../src/lib/darwin-keychain.js', () => ({
  DarwinSecurityEntry: class {
    constructor() {
      forbidden();
    }
  },
}));
// Reject asynchronously like fetch does, allowing Yoga's embedded-WASM fallback.
globalThis.fetch = async () => forbidden();

const { createInstallerEventEmitter } = await import('../src/lib/events.js');
const { CLIAdapter } = await import('../src/lib/adapters/cli-adapter.js');
const { TuiAdapter } = await import('../src/lib/adapters/tui-adapter.js');
const { getUiHost } = await import('../src/utils/ui.js');
const emitter = createInstallerEventEmitter();
const events: string[] = [];
const report = (stage: string) => appendFile(evidence, `${JSON.stringify({ stage, events })}\n`);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let finished!: () => void;
const done = new Promise<void>((resolve) => (finished = resolve));
const inputBefore = process.stdin.listenerCount('readable');
const config = {
  emitter,
  sendEvent(event: { type: string }) {
    events.push(event.type);
    if (event.type === 'GIT_CANCELLED') {
      emitter.emit('complete', { success: false, summary: 'Synthetic cancellation' });
      finished();
    }
    if (event.type === 'PR_APPROVED') finished();
  },
};
const adapter =
  mode === 'tui'
    ? new TuiAdapter({ ...config, installDir: process.cwd(), tipIntervalMs: 60_000 })
    : new CLIAdapter(config);

// Driver enforces its own process-group deadline too.
const timeout = setTimeout(() => {
  throw new Error('PTY fixture timed out');
}, 10_000);
try {
  await adapter.start();
  // Ink's restore-cursor dependency deliberately keeps a process-exit hook;
  // check the adapter's own SIGINT listener, not that shared library hook.
  const cliSigint = process.listeners('SIGINT').find((listener) => listener.name === 'handleSigInt');
  assert(cliSigint);
  emitter.emit('agent:start', {});
  if (scenario === 'cancel') {
    emitter.emit('git:dirty', { files: ['synthetic.rb'] });
    emitter.emit('branch:prompt', { branch: 'main' });
  } else {
    emitter.emit('postinstall:commit:prompt', {});
    emitter.emit('postinstall:pr:prompt', {});
  }
  await delay(350);
  emitter.emit('agent:success', { summary: 'Synthetic Rails/no-validation completion' });
  emitter.emit('postinstall:commit:generating', {});
  emitter.emit('postinstall:pr:generating', {});
  emitter.emit('postinstall:pr:pushing', {});
  emitter.emit('agent:tool', { kind: 'command', detail: 'synthetic-no-op' });
  await report('replaced');
  if (scenario === 'stop') await delay(400);
  else await done;
  await adapter.stop();
  await report('stopped');
  assert.equal(getUiHost(), null);
  assert.equal(process.stdin.isRaw, false);
  assert(!process.listeners('SIGINT').includes(cliSigint));
  assert.equal(process.stdin.listenerCount('readable'), inputBefore);
  assert.equal(emitter.listenerCount('agent:start'), 0);
  if (scenario === 'answers') assert.deepEqual(events, ['COMMIT_DECLINED', 'PR_APPROVED']);
  if (scenario === 'cancel') assert(events.includes('GIT_CANCELLED'));
  // Leave the process alive long enough to detect orphaned redraw intervals.
  await delay(400);
  await report('clean');
} finally {
  clearTimeout(timeout);
  await adapter.stop();
  process.stdin.pause();
}
