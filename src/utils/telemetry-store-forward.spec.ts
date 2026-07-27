import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPersistToFile = vi.fn();
const mockQueueEvents = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

vi.mock('./telemetry-client.js', () => ({
  telemetryClient: {
    persistToFile: (...args: unknown[]) => mockPersistToFile(...args),
    queueEvents: (...args: unknown[]) => mockQueueEvents(...args),
    flush: () => mockFlush(),
  },
}));

vi.mock('./debug.js', () => ({
  debug: vi.fn(),
}));

const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockStatSync = vi.fn();
const mockUnlinkSync = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (...args: unknown[]) => mockExistsSync(...args),
    readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
    readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
    statSync: (...args: unknown[]) => mockStatSync(...args),
    unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  };
});

describe('telemetry-store-forward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatSync.mockReturnValue({ mtimeMs: Date.now() });
  });

  describe('installStoreForward', () => {
    it('registers a process exit handler', async () => {
      const onSpy = vi.spyOn(process, 'on');
      vi.resetModules();

      const { installStoreForward } = await import('./telemetry-store-forward.js');
      installStoreForward();

      const exitHandlers = onSpy.mock.calls.filter((c) => c[0] === 'exit');
      expect(exitHandlers.length).toBeGreaterThanOrEqual(1);

      onSpy.mockRestore();
    });

    it('exit handler calls persistToFile with PID-based path', async () => {
      const onSpy = vi.spyOn(process, 'on');
      vi.resetModules();

      const { installStoreForward } = await import('./telemetry-store-forward.js');
      installStoreForward();

      const exitHandler = onSpy.mock.calls.find((c) => c[0] === 'exit')?.[1] as () => void;
      exitHandler();

      expect(mockPersistToFile).toHaveBeenCalledTimes(1);
      const filePath = mockPersistToFile.mock.calls[0][0] as string;
      expect(filePath).toContain('workos-cli-telemetry');
      expect(filePath).toContain(`pending-${process.pid}`);

      onSpy.mockRestore();
    });
  });

  describe('recoverPendingEvents', () => {
    it('does nothing if pending dir does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      vi.resetModules();

      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      expect(mockReaddirSync).not.toHaveBeenCalled();
      expect(mockQueueEvents).not.toHaveBeenCalled();
    });

    it('reads and queues events from pending files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['pending-1234.json', 'pending-5678.json']);
      const events1 = [{ type: 'command', sessionId: '1', timestamp: '2024-01-01T00:00:00Z' }];
      const events2 = [{ type: 'crash', sessionId: '2', timestamp: '2024-01-01T00:00:01Z' }];
      mockReadFileSync.mockReturnValueOnce(JSON.stringify(events1)).mockReturnValueOnce(JSON.stringify(events2));

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      expect(mockQueueEvents).toHaveBeenCalledTimes(2);
      expect(mockQueueEvents).toHaveBeenCalledWith(events1);
      expect(mockQueueEvents).toHaveBeenCalledWith(events2);
      expect(mockFlush).toHaveBeenCalledTimes(1);
    });

    it('deletes files immediately after reading (before send)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['pending-1234.json']);
      mockReadFileSync.mockReturnValue(JSON.stringify([{ type: 'command', sessionId: '1', timestamp: 'x' }]));

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      // unlinkSync should be called before flush
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
      const unlinkPath = mockUnlinkSync.mock.calls[0][0] as string;
      expect(unlinkPath).toContain('pending-1234.json');
    });

    it('handles corrupted files gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['pending-bad.json']);
      mockReadFileSync.mockReturnValue('not valid json{{{');

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');

      // Should not throw
      await expect(recoverPendingEvents()).resolves.toBeUndefined();
      // Should try to delete the corrupted file
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('skips non-pending files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['pending-1234.json', 'other-file.txt', 'readme.md']);

      const events = [{ type: 'command', sessionId: '1', timestamp: 'x' }];
      mockReadFileSync.mockReturnValue(JSON.stringify(events));

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      expect(mockReadFileSync).toHaveBeenCalledTimes(1);
    });

    it('skips empty event arrays', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['pending-1234.json']);
      mockReadFileSync.mockReturnValue('[]');

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      expect(mockQueueEvents).not.toHaveBeenCalled();
    });

    it('drops stale pending files without reading them', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['pending-old.json']);
      mockStatSync.mockReturnValue({ mtimeMs: Date.now() - 8 * 24 * 60 * 60 * 1000 });

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      expect(mockReadFileSync).not.toHaveBeenCalled();
      expect(mockUnlinkSync).toHaveBeenCalledTimes(1);
    });

    it('caps recovered pending files and drops the oldest excess files', async () => {
      mockExistsSync.mockReturnValue(true);
      const files = Array.from({ length: 101 }, (_, i) => `pending-${i}.json`);
      mockReaddirSync.mockReturnValue(files);
      mockStatSync.mockImplementation((filePath: string) => {
        const match = filePath.match(/pending-(\d+)\.json$/);
        return { mtimeMs: Date.now() + Number(match?.[1] ?? 0) };
      });
      mockReadFileSync.mockReturnValue(JSON.stringify([{ type: 'command', sessionId: '1', timestamp: 'x' }]));

      vi.resetModules();
      const { recoverPendingEvents } = await import('./telemetry-store-forward.js');
      await recoverPendingEvents();

      expect(mockReadFileSync).toHaveBeenCalledTimes(100);
      expect(mockUnlinkSync.mock.calls.some(([filePath]) => String(filePath).includes('pending-0.json'))).toBe(true);
    });
  });
});
