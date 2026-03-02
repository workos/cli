import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  events: {
    listEvents: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { runEventList } = await import('./event.js');

describe('event commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runEventList', () => {
    it('lists events in table format', async () => {
      mockSdk.events.listEvents.mockResolvedValue({
        data: [
          { id: 'evt_01', event: 'dsync.user.created', createdAt: '2025-01-15T10:00:00Z' },
          { id: 'evt_02', event: 'connection.activated', createdAt: '2025-01-15T11:00:00Z' },
        ],
        listMetadata: { before: null, after: null },
      });

      await runEventList({ events: ['dsync.user.created', 'connection.activated'] }, 'sk_test');

      expect(mockSdk.events.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({ events: ['dsync.user.created', 'connection.activated'] }),
      );
      expect(consoleOutput.some((l) => l.includes('evt_01'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('dsync.user.created'))).toBe(true);
    });

    it('passes optional filters', async () => {
      mockSdk.events.listEvents.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });

      await runEventList(
        {
          events: ['dsync.user.created'],
          after: 'cursor_a',
          organizationId: 'org_123',
          rangeStart: '2025-01-01',
          rangeEnd: '2025-02-01',
          limit: 10,
        },
        'sk_test',
      );

      expect(mockSdk.events.listEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          events: ['dsync.user.created'],
          after: 'cursor_a',
          organizationId: 'org_123',
          rangeStart: '2025-01-01',
          rangeEnd: '2025-02-01',
          limit: 10,
        }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.events.listEvents.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });

      await runEventList({ events: ['dsync.user.created'] }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No events found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.events.listEvents.mockResolvedValue({
        data: [{ id: 'evt_01', event: 'dsync.user.created', createdAt: '2025-01-15T10:00:00Z' }],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });

      await runEventList({ events: ['dsync.user.created'] }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });

    it('handles API errors', async () => {
      mockSdk.events.listEvents.mockRejectedValue(new Error('Bad request'));

      await expect(runEventList({ events: ['dsync.user.created'] }, 'sk_test')).rejects.toThrow();
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('outputs JSON with data and listMetadata', async () => {
      mockSdk.events.listEvents.mockResolvedValue({
        data: [{ id: 'evt_01', event: 'dsync.user.created', createdAt: '2025-01-15T10:00:00Z' }],
        listMetadata: { before: null, after: 'cursor_a' },
      });

      await runEventList({ events: ['dsync.user.created'] }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('evt_01');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('outputs empty data array for no results', async () => {
      mockSdk.events.listEvents.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });

      await runEventList({ events: ['dsync.user.created'] }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });
  });
});
