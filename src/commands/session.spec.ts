import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  userManagement: {
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runSessionList, runSessionRevoke } = await import('./session.js');

const mockSession = {
  id: 'session_123',
  userId: 'user_456',
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
  authMethod: 'password',
  status: 'active',
  expiresAt: '2024-02-01T00:00:00Z',
  endedAt: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('session commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runSessionList', () => {
    it('lists sessions for a user', async () => {
      mockSdk.userManagement.listSessions.mockResolvedValue({
        data: [mockSession],
        listMetadata: { before: null, after: null },
      });
      await runSessionList('user_456', {}, 'sk_test');
      expect(mockSdk.userManagement.listSessions).toHaveBeenCalledWith('user_456', expect.any(Object));
      expect(consoleOutput.some((l) => l.includes('session_123'))).toBe(true);
    });

    it('handles empty results', async () => {
      mockSdk.userManagement.listSessions.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runSessionList('user_456', {}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No sessions found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.userManagement.listSessions.mockResolvedValue({
        data: [mockSession],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runSessionList('user_456', {}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });

    it('displays user agent and IP in table', async () => {
      mockSdk.userManagement.listSessions.mockResolvedValue({
        data: [mockSession],
        listMetadata: { before: null, after: null },
      });
      await runSessionList('user_456', {}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Mozilla/5.0'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('192.168.1.1'))).toBe(true);
    });
  });

  describe('runSessionRevoke', () => {
    it('revokes session and prints confirmation', async () => {
      mockSdk.userManagement.revokeSession.mockResolvedValue(undefined);
      await runSessionRevoke('session_123', 'sk_test');
      expect(mockSdk.userManagement.revokeSession).toHaveBeenCalledWith({ sessionId: 'session_123' });
      expect(consoleOutput.some((l) => l.includes('Revoked session'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('session_123'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runSessionList outputs JSON with data and listMetadata', async () => {
      mockSdk.userManagement.listSessions.mockResolvedValue({
        data: [mockSession],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runSessionList('user_456', {}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('session_123');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runSessionList outputs empty data array for no results', async () => {
      mockSdk.userManagement.listSessions.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runSessionList('user_456', {}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runSessionRevoke outputs JSON success', async () => {
      mockSdk.userManagement.revokeSession.mockResolvedValue(undefined);
      await runSessionRevoke('session_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('session_123');
    });
  });
});
