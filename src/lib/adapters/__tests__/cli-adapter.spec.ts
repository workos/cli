import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIAdapter } from '../cli-adapter.js';
import { createWizardEventEmitter } from '../../events.js';

// Mock console.log to capture styled output
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

// Mock clack
vi.mock('../../../utils/clack.js', () => ({
  default: {
    intro: vi.fn(),
    log: {
      step: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
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

vi.mock('../../settings.js', () => ({
  getConfig: vi.fn(() => ({
    branding: {
      showAsciiArt: false,
      useCompact: true,
      compactAsciiArt: 'Test Wizard',
      asciiArt: 'Big Art',
    },
  })),
}));

// Mock cli-symbols to avoid chalk color codes in test assertions
vi.mock('../../../utils/cli-symbols.js', () => ({
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
  let emitter: ReturnType<typeof createWizardEventEmitter>;
  let sendEvent: ReturnType<typeof vi.fn>;
  let adapter: CLIAdapter;

  beforeEach(() => {
    emitter = createWizardEventEmitter();
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

      // Emit auth:success - this one outputs via console.log
      emitter.emit('auth:success', {});

      expect(mockConsoleLog).toHaveBeenCalledWith('✓ Authenticated');
    });

    it('shows intro on start', async () => {
      const clack = await import('../../../utils/clack.js');
      await adapter.start();

      expect(clack.default.intro).toHaveBeenCalledWith('Welcome to the WorkOS AuthKit setup wizard');
    });

    it('is idempotent', async () => {
      const clack = await import('../../../utils/clack.js');
      await adapter.start();
      await adapter.start(); // Second call should be no-op

      expect(clack.default.intro).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop', () => {
    it('unsubscribes from events on stop', async () => {
      await adapter.start();
      await adapter.stop();

      const clack = await import('../../../utils/clack.js');
      vi.clearAllMocks();

      // Emit an event - handler should NOT be called
      emitter.emit('auth:checking', {});

      expect(clack.default.log.step).not.toHaveBeenCalled();
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

      emitter.emit('detection:complete', { integration: 'nextjs' });

      // Now uses console.log with styled.success
      expect(mockConsoleLog).toHaveBeenCalled();
      const calls = mockConsoleLog.mock.calls.flat();
      expect(calls.some((c) => typeof c === 'string' && c.includes('Detected') && c.includes('nextjs'))).toBe(true);
    });

    it('shows spinner on agent:start', async () => {
      await adapter.start();
      const clack = await import('../../../utils/clack.js');

      emitter.emit('agent:start', {});

      expect(clack.default.spinner).toHaveBeenCalled();
    });

    it('updates spinner on agent:progress', async () => {
      await adapter.start();
      const clack = await import('../../../utils/clack.js');
      const spinnerMock = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      vi.mocked(clack.default.spinner).mockReturnValue(spinnerMock);

      emitter.emit('agent:start', {});
      emitter.emit('agent:progress', { step: 'Installing', detail: 'packages' });

      expect(spinnerMock.message).toHaveBeenCalledWith('Installing: packages');
    });

    it('sends GIT_CONFIRMED on confirm', async () => {
      await adapter.start();
      const clack = await import('../../../utils/clack.js');
      vi.mocked(clack.default.confirm).mockResolvedValue(true);

      emitter.emit('git:dirty', { files: ['file1.ts'] });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CONFIRMED' });
    });

    it('sends GIT_CANCELLED on decline', async () => {
      await adapter.start();
      const clack = await import('../../../utils/clack.js');
      vi.mocked(clack.default.confirm).mockResolvedValue(false);

      emitter.emit('git:dirty', { files: ['file1.ts'] });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({ type: 'GIT_CANCELLED' });
    });

    it('sends CREDENTIALS_SUBMITTED on credentials form', async () => {
      await adapter.start();
      const clack = await import('../../../utils/clack.js');
      vi.mocked(clack.default.text).mockResolvedValueOnce('client_123'); // clientId
      vi.mocked(clack.default.password).mockResolvedValueOnce('sk_test'); // apiKey (now uses password input)

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
      const clack = await import('../../../utils/clack.js');
      vi.mocked(clack.default.isCancel).mockReturnValue(true);
      vi.mocked(clack.default.text).mockResolvedValue(Symbol('cancel'));

      emitter.emit('credentials:request', { requiresApiKey: false });

      await new Promise((r) => setTimeout(r, 10));

      expect(sendEvent).toHaveBeenCalledWith({ type: 'CANCEL' });
    });

    it('shows success outro on complete', async () => {
      await adapter.start();

      emitter.emit('complete', { success: true, summary: 'All done!' });

      // New completion handler uses styled output, not clack.outro
      expect(mockConsoleLog).toHaveBeenCalledWith('✓ WorkOS AuthKit installed!');
      expect(mockConsoleLog).toHaveBeenCalledWith('Next steps:');
    });

    it('shows error on failure complete', async () => {
      await adapter.start();

      emitter.emit('complete', { success: false, summary: 'Something went wrong' });

      // New completion handler uses styled.error and styled.info
      expect(mockConsoleLog).toHaveBeenCalledWith('✗ Installation failed');
      expect(mockConsoleLog).toHaveBeenCalledWith('ℹ Something went wrong');
    });
  });
});
