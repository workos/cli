import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeadlessAdapter } from './headless-adapter.js';
import { createInstallerEventEmitter } from '../events.js';
import type { InstallerEventEmitter } from '../events.js';
import type { HeadlessOptions } from './headless-adapter.js';

// Mock ndjson writer to capture events
const mockWriteNDJSON = vi.fn();
vi.mock('../../utils/ndjson.js', () => ({
  writeNDJSON: (...args: unknown[]) => mockWriteNDJSON(...args),
}));

// Mock process.exit
const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

describe('HeadlessAdapter', () => {
  let emitter: InstallerEventEmitter;
  let sendEvent: ReturnType<typeof vi.fn>;

  function createAdapter(options: HeadlessOptions = {}) {
    return new HeadlessAdapter({ emitter, sendEvent, options });
  }

  beforeEach(() => {
    emitter = createInstallerEventEmitter();
    sendEvent = vi.fn();
    mockWriteNDJSON.mockClear();
    mockExit.mockClear();
  });

  afterEach(async () => {
    vi.clearAllMocks();
  });

  describe('start/stop', () => {
    it('is idempotent on start', async () => {
      const adapter = createAdapter();
      await adapter.start();
      await adapter.start(); // no-op

      emitter.emit('auth:success', {});
      expect(mockWriteNDJSON).toHaveBeenCalledTimes(1);
      await adapter.stop();
    });

    it('is idempotent on stop', async () => {
      const adapter = createAdapter();
      await adapter.start();
      await adapter.stop();
      await adapter.stop(); // no-op — should not throw
    });

    it('unsubscribes from events on stop', async () => {
      const adapter = createAdapter();
      await adapter.start();
      await adapter.stop();

      mockWriteNDJSON.mockClear();
      emitter.emit('auth:success', {});
      expect(mockWriteNDJSON).not.toHaveBeenCalled();
    });
  });

  describe('auth events', () => {
    it('writes NDJSON on auth:success', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('auth:success', {});

      expect(mockWriteNDJSON).toHaveBeenCalledWith({ type: 'auth:success' });
      await adapter.stop();
    });

    it('exits with code 4 on auth:failure', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('auth:failure', { message: 'Token expired' });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'auth:required',
        message: 'Token expired',
      });
      expect(mockExit).toHaveBeenCalledWith(4);
      await adapter.stop();
    });
  });

  describe('detection events', () => {
    it('writes detection:complete', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('detection:complete', { integration: 'nextjs' });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'detection:complete',
        integration: 'nextjs',
      });
      await adapter.stop();
    });

    it('writes detection:none', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('detection:none', {});

      expect(mockWriteNDJSON).toHaveBeenCalledWith({ type: 'detection:none' });
      await adapter.stop();
    });
  });

  describe('git:dirty handling', () => {
    it('fails fast by default on dirty working tree', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('git:dirty', { files: ['package.json'] });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'git:status',
        dirty: true,
        files: ['package.json'],
      });
      expect(mockWriteNDJSON).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'git_dirty' }));
      expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CANCELLED' });
      expect(mockExit).toHaveBeenCalledWith(1);
      await adapter.stop();
    });

    it('continues when --no-git-check is set', async () => {
      const adapter = createAdapter({ noGitCheck: true });
      await adapter.start();

      emitter.emit('git:dirty', { files: ['package.json'] });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'git:decision',
        action: 'continue',
      });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CONFIRMED' });
      expect(mockExit).not.toHaveBeenCalled();
      await adapter.stop();
    });
  });

  describe('credentials auto-resolution', () => {
    it('submits credentials from flags', async () => {
      const adapter = createAdapter({ apiKey: 'sk_test_123', clientId: 'client_abc' });
      await adapter.start();

      emitter.emit('credentials:request', { requiresApiKey: true });

      expect(sendEvent).toHaveBeenCalledWith({
        type: 'CREDENTIALS_SUBMITTED',
        apiKey: 'sk_test_123',
        clientId: 'client_abc',
      });
      await adapter.stop();
    });

    it('errors when clientId missing', async () => {
      const adapter = createAdapter({ apiKey: 'sk_test_123' });
      await adapter.start();

      emitter.emit('credentials:request', { requiresApiKey: false });

      expect(mockWriteNDJSON).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', code: 'missing_credentials' }),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      await adapter.stop();
    });

    it('errors when apiKey missing but required', async () => {
      const adapter = createAdapter({ clientId: 'client_abc' });
      await adapter.start();

      emitter.emit('credentials:request', { requiresApiKey: true });

      expect(mockWriteNDJSON).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error', code: 'missing_credentials' }),
      );
      expect(mockExit).toHaveBeenCalledWith(1);
      await adapter.stop();
    });

    it('submits without apiKey when not required', async () => {
      const adapter = createAdapter({ clientId: 'client_abc' });
      await adapter.start();

      emitter.emit('credentials:request', { requiresApiKey: false });

      expect(sendEvent).toHaveBeenCalledWith({
        type: 'CREDENTIALS_SUBMITTED',
        apiKey: '',
        clientId: 'client_abc',
      });
      await adapter.stop();
    });

    it('auto-approves env scan', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('credentials:env:prompt', { files: ['.env.local'] });

      expect(sendEvent).toHaveBeenCalledWith({ type: 'ENV_SCAN_APPROVED' });
      await adapter.stop();
    });
  });

  describe('branch auto-resolution', () => {
    it('auto-creates branch by default', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('branch:prompt', { branch: 'main' });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({ type: 'branch:creating' });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'BRANCH_CREATE' });
      await adapter.stop();
    });

    it('skips branch with --no-branch flag', async () => {
      const adapter = createAdapter({ noBranch: true });
      await adapter.start();

      emitter.emit('branch:prompt', { branch: 'main' });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'branch:skipped',
        reason: '--no-branch flag',
      });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'BRANCH_CONTINUE' });
      await adapter.stop();
    });
  });

  describe('commit auto-resolution', () => {
    it('auto-commits by default', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('postinstall:commit:prompt', {});

      expect(mockWriteNDJSON).toHaveBeenCalledWith({ type: 'commit:auto' });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'COMMIT_APPROVED' });
      await adapter.stop();
    });

    it('skips commit with --no-commit flag', async () => {
      const adapter = createAdapter({ noCommit: true });
      await adapter.start();

      emitter.emit('postinstall:commit:prompt', {});

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'commit:skipped',
        reason: '--no-commit flag',
      });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'COMMIT_DECLINED' });
      await adapter.stop();
    });
  });

  describe('PR auto-resolution', () => {
    it('skips PR by default', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('postinstall:pr:prompt', {});

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'pr:skipped',
        reason: '--create-pr not set',
      });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'PR_DECLINED' });
      await adapter.stop();
    });

    it('creates PR with --create-pr flag', async () => {
      const adapter = createAdapter({ createPr: true });
      await adapter.start();

      emitter.emit('postinstall:pr:prompt', {});

      expect(mockWriteNDJSON).toHaveBeenCalledWith({ type: 'pr:creating' });
      expect(sendEvent).toHaveBeenCalledWith({ type: 'PR_APPROVED' });
      await adapter.stop();
    });
  });

  describe('terminal events', () => {
    it('writes complete event', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('complete', { success: true, summary: 'All done' });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'complete',
        success: true,
        summary: 'All done',
      });
      await adapter.stop();
    });

    it('writes error event', async () => {
      const adapter = createAdapter();
      await adapter.start();

      emitter.emit('error', { message: 'Something broke', stack: 'stack trace' });

      expect(mockWriteNDJSON).toHaveBeenCalledWith({
        type: 'error',
        code: 'installer_error',
        message: 'Something broke',
      });
      await adapter.stop();
    });
  });
});
