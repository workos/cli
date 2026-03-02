import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  userManagement: {
    getUser: vi.fn(),
    listUsers: vi.fn(),
    updateUser: vi.fn(),
    deleteUser: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runUserGet, runUserList, runUserUpdate, runUserDelete } = await import('./user.js');

describe('user commands', () => {
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

  describe('runUserGet', () => {
    it('fetches and prints user as JSON', async () => {
      mockSdk.userManagement.getUser.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserGet('user_123', 'sk_test');
      expect(mockSdk.userManagement.getUser).toHaveBeenCalledWith('user_123');
      expect(consoleOutput.some((l) => l.includes('user_123'))).toBe(true);
    });
  });

  describe('runUserList', () => {
    it('lists users in table format', async () => {
      mockSdk.userManagement.listUsers.mockResolvedValue({
        data: [
          {
            id: 'user_123',
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
            emailVerified: true,
          },
        ],
        listMetadata: { before: null, after: null },
      });
      await runUserList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('test@example.com'))).toBe(true);
    });

    it('passes filter params', async () => {
      mockSdk.userManagement.listUsers.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runUserList({ email: 'test@example.com', organization: 'org_123', limit: 5 }, 'sk_test');
      expect(mockSdk.userManagement.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ email: 'test@example.com', organizationId: 'org_123', limit: 5 }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.userManagement.listUsers.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runUserList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No users found'))).toBe(true);
    });

    it('shows pagination cursors when present', async () => {
      mockSdk.userManagement.listUsers.mockResolvedValue({
        data: [{ id: 'user_1', email: 'a@b.com', firstName: '', lastName: '', emailVerified: false }],
        listMetadata: { before: 'cur_b', after: 'cur_a' },
      });
      await runUserList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cur_b'))).toBe(true);
    });
  });

  describe('runUserUpdate', () => {
    it('updates user with provided fields', async () => {
      mockSdk.userManagement.updateUser.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserUpdate('user_123', 'sk_test', { firstName: 'John', lastName: 'Doe' });
      expect(mockSdk.userManagement.updateUser).toHaveBeenCalledWith({
        userId: 'user_123',
        firstName: 'John',
        lastName: 'Doe',
      });
    });

    it('sends only provided fields', async () => {
      mockSdk.userManagement.updateUser.mockResolvedValue({ id: 'user_123' });
      await runUserUpdate('user_123', 'sk_test', { emailVerified: true });
      expect(mockSdk.userManagement.updateUser).toHaveBeenCalledWith({
        userId: 'user_123',
        emailVerified: true,
      });
    });
  });

  describe('runUserDelete', () => {
    it('deletes user and prints confirmation', async () => {
      mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);
      await runUserDelete('user_123', 'sk_test');
      expect(mockSdk.userManagement.deleteUser).toHaveBeenCalledWith('user_123');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('user_123'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runUserGet outputs raw JSON', async () => {
      mockSdk.userManagement.getUser.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserGet('user_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('user_123');
      expect(output.email).toBe('test@example.com');
      expect(output).not.toHaveProperty('status');
    });

    it('runUserList outputs JSON with data and listMetadata', async () => {
      mockSdk.userManagement.listUsers.mockResolvedValue({
        data: [
          {
            id: 'user_123',
            email: 'test@example.com',
            firstName: 'Test',
            lastName: 'User',
            emailVerified: true,
          },
        ],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runUserList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].email).toBe('test@example.com');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runUserList outputs empty data array for no results', async () => {
      mockSdk.userManagement.listUsers.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runUserList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runUserUpdate outputs JSON success', async () => {
      mockSdk.userManagement.updateUser.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserUpdate('user_123', 'sk_test', { firstName: 'John' });
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Updated user');
      expect(output.data.id).toBe('user_123');
    });

    it('runUserDelete outputs JSON success', async () => {
      mockSdk.userManagement.deleteUser.mockResolvedValue(undefined);
      await runUserDelete('user_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('user_123');
    });
  });
});
