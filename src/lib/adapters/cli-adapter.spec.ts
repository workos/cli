import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIAdapter } from './cli-adapter.js';
import { createInstallerEventEmitter } from '../events.js';

// Mock console.log to capture styled output
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock the UI facade
vi.mock('../../utils/ui.js', () => ({
  default: {
    intro: vi.fn(),
    log: {
      step: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      message: vi.fn(),
    },
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    })),
    confirm: vi.fn(),
    text: vi.fn(),
    password: vi.fn(),
    isCancel: vi.fn(() => false),
    outro: vi.fn(),
  },
}));

vi.mock('../settings.js', () => ({
  getConfig: vi.fn(() => ({
    branding: {
      showAsciiArt: false,
      useCompact: true,
      compactAsciiArt: 'Test Installer',
      asciiArt: 'Big Art',
    },
  })),
}));

// Mock cli-symbols to avoid chalk color codes in test assertions
vi.mock('../../utils/cli-symbols.js', () => ({
  styled: {
    success: (text: string) => `✓ ${text}`,
    error: (text: string) => `✗ ${text}`,
    warning: (text: string) => `! ${text}`,
    info: (text: string) => `ℹ ${text}`,
    action: (text: string) => `→ ${text}`,
    label: (label: string, value: string) => `${label} ${value}`,
    phase: (num: number, total: number, name: string) => `${'▓'.repeat(num)}${'░'.repeat(total - num)} ${name}`,
    bullet: (text: string) => `  • ${text}`,
  },
  symbols: {
    success: '✓',
    error: '✗',
    warning: '!',
    info: 'ℹ',
    arrow: '→',
    bullet: '•',
    progressFilled: '▓',
    progressEmpty: '░',
  },
}));

describe('CLIAdapter', () => {
  let emitter: ReturnType<typeof createInstallerEventEmitter>;
  let sendEvent: ReturnType<typeof vi.fn>;
  let adapter: CLIAdapter;

  beforeEach(() => {
    emitter = createInstallerEventEmitter();
    sendEvent = vi.fn();
    adapter = new CLIAdapter({ emitter, sendEvent });
  });

  afterEach(async () => {
    await adapter.stop();
    vi.clearAllMocks();
    mockConsoleLog.mockClear();
  });

  describe('start', () => {
    it('subscribes to events on start', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      // Emit auth:success - uses ui.log.success
      emitter.emit('auth:success', {});

      expect(ui.default.log.success).toHaveBeenCalledWith('Authenticated');
    });

    it('shows intro on start', async () => {
      const ui = await import('../../utils/ui.js');
      await adapter.start();

      expect(ui.default.intro).toHaveBeenCalledWith('WorkOS', 'AuthKit installer');
    });

    it('is idempotent', async () => {
      const ui = await import('../../utils/ui.js');
      await adapter.start();
      await adapter.start(); // Second call should be no-op

      expect(ui.default.intro).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('unsubscribes from events on stop', async () => {
      await adapter.start();
      await adapter.stop();

      const ui = await import('../../utils/ui.js');
      vi.clearAllMocks();

      // Emit an event - handler should NOT be called
      emitter.emit('auth:checking', {});

      expect(ui.default.log.step).not.toHaveBeenCalled();
    });

    it('is idempotent', async () => {
      await adapter.start();
      await adapter.stop();
      await adapter.stop(); // Second call should be no-op
      // Should not throw
    });
  });

  describe('event handling', () => {
    it('shows detection complete message', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('detection:complete', { integration: 'nextjs' });

      // Uses ui.log.success
      expect(ui.default.log.success).toHaveBeenCalled();
    });

    it('shows spinner on agent:start', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('agent:start', {});

      expect(ui.default.spinner).toHaveBeenCalled();
    });

    it('updates spinner on agent:progress', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(ui.default.spinner).mockReturnValue(spinnerMock);

      emitter.emit('agent:start', {});
      emitter.emit('agent:progress', { step: 'Installing', detail: 'packages' });

      expect(spinnerMock.message).toHaveBeenCalledWith('Installing: packages');
    });

    it('sends GIT_CONFIRMED on confirm', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');
      vi.mocked(ui.default.confirm).mockResolvedValue(true);

      emitter.emit('git:dirty', { files: ['file1.ts'] });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CONFIRMED' });
    });

    it('sends GIT_CANCELLED on decline', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');
      vi.mocked(ui.default.confirm).mockResolvedValue(false);

      emitter.emit('git:dirty', { files: ['file1.ts'] });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CANCELLED' });
    });

    it('sends CREDENTIALS_SUBMITTED on credentials form', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');
      vi.mocked(ui.default.text).mockResolvedValueOnce('client_123'); // clientId
      vi.mocked(ui.default.password).mockResolvedValueOnce('sk_test'); // apiKey (now uses password input)

      emitter.emit('credentials:request', { requiresApiKey: true });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({
        type: 'CREDENTIALS_SUBMITTED',
        apiKey: 'sk_test',
        clientId: 'client_123',
      });
    });

    it('sends CANCEL when credentials form is cancelled', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');
      vi.mocked(ui.default.isCancel).mockReturnValue(true);
      vi.mocked(ui.default.text).mockResolvedValue(Symbol('cancel'));

      emitter.emit('credentials:request', { requiresApiKey: false });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({ type: 'CANCEL' });
    });

    it('shows structured success summary box on complete', async () => {
      await adapter.start();
      const consoleSpy = vi.spyOn(console, 'log');

      emitter.emit('complete', {
        success: true,
        summary: 'All done!',
        completion: {
          integration: 'nextjs',
          devCommand: 'pnpm run dev',
          url: 'http://localhost:3000',
          files: ['app/auth/route.ts'],
          nextSteps: [
            'Run `pnpm run dev` to start your dev server',
            'Open http://localhost:3000 to test authentication',
          ],
          docsUrl: 'https://workos.com/docs/user-management/authkit/nextjs',
          dashboardUrl: 'https://dashboard.workos.com',
        },
      });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('WorkOS AuthKit Installed');
      expect(output).toContain('pnpm run dev');
      expect(output).toContain('app/auth/route.ts');
      consoleSpy.mockRestore();
    });

    it('renders persistent step lines for file operations', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('agent:start', {});
      emitter.emit('file:write', { path: '/proj/src/auth.ts', content: 'secret' });
      emitter.emit('file:edit', { path: '/proj/src/app.ts', oldContent: 'a', newContent: 'b' });

      const stepCalls = vi.mocked(ui.default.log.step).mock.calls.map((c) => String(c[0]));
      expect(stepCalls.some((s) => s.includes('src/auth.ts'))).toBe(true);
      expect(stepCalls.some((s) => s.includes('src/app.ts'))).toBe(true);
    });

    it('dedupes consecutive same-path file operations', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('agent:start', {});
      emitter.emit('file:edit', { path: '/proj/src/app.ts', oldContent: 'a', newContent: 'b' });
      emitter.emit('file:edit', { path: '/proj/src/app.ts', oldContent: 'b', newContent: 'c' });

      const appCalls = vi.mocked(ui.default.log.step).mock.calls.filter((c) => String(c[0]).includes('src/app.ts'));
      expect(appCalls).toHaveLength(1);
    });

    it('does not clobber the phase message back to a generic string', async () => {
      vi.useFakeTimers();
      try {
        await adapter.start();
        const ui = await import('../../utils/ui.js');
        const spinnerMock = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
        vi.mocked(ui.default.spinner).mockReturnValue(spinnerMock);

        emitter.emit('agent:start', {});
        emitter.emit('agent:progress', { step: 'Configuring middleware' });
        vi.advanceTimersByTime(5000);

        const clobbered = spinnerMock.message.mock.calls
          .map((c) => String(c[0]))
          .filter((m) => /Running AI agent/.test(m));
        expect(clobbered).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('restarts the spinner on the last phase message after logging a file op', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');
      const spinnerMock = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
      vi.mocked(ui.default.spinner).mockReturnValue(spinnerMock);

      emitter.emit('agent:start', {});
      emitter.emit('agent:progress', { step: 'Configuring middleware' });
      emitter.emit('file:write', { path: '/proj/src/auth.ts', content: 'x' });

      expect(spinnerMock.stop).toHaveBeenCalled();
      expect(spinnerMock.start).toHaveBeenCalledWith('Configuring middleware');
    });

    it('renders Bash tool calls as step lines (agent:tool)', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('agent:start', {});
      emitter.emit('agent:tool', { kind: 'command', detail: 'pnpm add @workos-inc/authkit-nextjs' });

      const stepCalls = vi.mocked(ui.default.log.step).mock.calls.map((c) => String(c[0]));
      expect(stepCalls.some((s) => s.includes('pnpm add @workos-inc/authkit-nextjs'))).toBe(true);
    });

    it('shows error summary box on failure complete', async () => {
      await adapter.start();
      const consoleSpy = vi.spyOn(console, 'log');

      emitter.emit('complete', { success: false, summary: 'Something went wrong' });

      const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(output).toContain('Installation Failed');
      expect(output).toContain('Something went wrong');
      consoleSpy.mockRestore();
    });

    it('keeps npx in auth recovery hints when launched through npm exec', async () => {
      const originalNpmCommand = process.env.npm_command;
      process.env.npm_command = 'exec';

      try {
        await adapter.start();
        const ui = await import('../../utils/ui.js');

        emitter.emit('error', { message: 'authentication failed', stack: undefined });

        expect(ui.default.log.info).toHaveBeenCalledWith(
          'Try running: npx workos@latest auth logout && npx workos@latest install',
        );
      } finally {
        if (originalNpmCommand === undefined) {
          delete process.env.npm_command;
        } else {
          process.env.npm_command = originalNpmCommand;
        }
      }
    });
  });

  describe('staging success copy', () => {
    it('device path announces a fresh environment without "retrieved"', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('staging:fetching', {});
      emitter.emit('staging:success', { source: 'device' });

      const calls = vi.mocked(ui.default.log.success).mock.calls.map((c) => String(c[0]));
      expect(calls).toContain('Set up a WorkOS environment for this install');
      expect(calls.join('\n')).not.toMatch(/retrieved/i);
    });

    it('stored path announces reuse of the active environment', async () => {
      await adapter.start();
      const ui = await import('../../utils/ui.js');

      emitter.emit('staging:fetching', {});
      emitter.emit('staging:success', { source: 'stored' });

      const calls = vi.mocked(ui.default.log.success).mock.calls.map((c) => String(c[0]));
      expect(calls).toContain('Using your active WorkOS environment');
      expect(calls.join('\n')).not.toMatch(/retrieved/i);
    });
  });
});
