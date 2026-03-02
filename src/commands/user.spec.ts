import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../lib/workos-api.js', () => ({
  workosRequest: vi.fn(),
  WorkOSApiError: class WorkOSApiError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code?: string,
      public readonly errors?: Array<{ message: string }>,
    ) {
      super(message);
      this.name = 'WorkOSApiError';
    }
  },
}));

const { workosRequest } = await import('../lib/workos-api.js');
const mockRequest = vi.mocked(workosRequest);
const { setOutputMode } = await import('../utils/output.js');

const { runUserGet, runUserList, runUserUpdate, runUserDelete } = await import('./user.js');

describe('user commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    mockRequest.mockReset();
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
      mockRequest.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserGet('user_123', 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: '/user_management/users/user_123' }),
      );
      expect(consoleOutput.some((l) => l.includes('user_123'))).toBe(true);
    });
  });

  describe('runUserList', () => {
    it('lists users in table format', async () => {
      mockRequest.mockResolvedValue({
        data: [
          { id: 'user_123', email: 'test@example.com', first_name: 'Test', last_name: 'User', email_verified: true },
        ],
        list_metadata: { before: null, after: null },
      });
      await runUserList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('test@example.com'))).toBe(true);
    });

    it('passes filter params', async () => {
      mockRequest.mockResolvedValue({ data: [], list_metadata: { before: null, after: null } });
      await runUserList({ email: 'test@example.com', organization: 'org_123', limit: 5 }, 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ email: 'test@example.com', organization_id: 'org_123', limit: 5 }),
        }),
      );
    });

    it('handles empty results', async () => {
      mockRequest.mockResolvedValue({ data: [], list_metadata: { before: null, after: null } });
      await runUserList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No users found'))).toBe(true);
    });

    it('shows pagination cursors when present', async () => {
      mockRequest.mockResolvedValue({
        data: [{ id: 'user_1', email: 'a@b.com', first_name: '', last_name: '', email_verified: false }],
        list_metadata: { before: 'cur_b', after: 'cur_a' },
      });
      await runUserList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cur_b'))).toBe(true);
    });
  });

  describe('runUserUpdate', () => {
    it('updates user with provided fields', async () => {
      mockRequest.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserUpdate('user_123', 'sk_test', { firstName: 'John', lastName: 'Doe' });
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          path: '/user_management/users/user_123',
          body: { first_name: 'John', last_name: 'Doe' },
        }),
      );
    });

    it('sends only provided fields', async () => {
      mockRequest.mockResolvedValue({ id: 'user_123' });
      await runUserUpdate('user_123', 'sk_test', { emailVerified: true });
      expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ body: { email_verified: true } }));
    });
  });

  describe('runUserDelete', () => {
    it('deletes user and prints confirmation', async () => {
      mockRequest.mockResolvedValue(null);
      await runUserDelete('user_123', 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE', path: '/user_management/users/user_123' }),
      );
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
      mockRequest.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserGet('user_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('user_123');
      expect(output.email).toBe('test@example.com');
      expect(output).not.toHaveProperty('status');
    });

    it('runUserList outputs JSON with data and list_metadata', async () => {
      mockRequest.mockResolvedValue({
        data: [
          { id: 'user_123', email: 'test@example.com', first_name: 'Test', last_name: 'User', email_verified: true },
        ],
        list_metadata: { before: null, after: 'cursor_a' },
      });
      await runUserList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].email).toBe('test@example.com');
      expect(output.list_metadata.after).toBe('cursor_a');
    });

    it('runUserList outputs empty data array for no results', async () => {
      mockRequest.mockResolvedValue({ data: [], list_metadata: { before: null, after: null } });
      await runUserList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.list_metadata).toBeDefined();
    });

    it('runUserUpdate outputs JSON success', async () => {
      mockRequest.mockResolvedValue({ id: 'user_123', email: 'test@example.com' });
      await runUserUpdate('user_123', 'sk_test', { firstName: 'John' });
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Updated user');
      expect(output.data.id).toBe('user_123');
    });

    it('runUserDelete outputs JSON success', async () => {
      mockRequest.mockResolvedValue(null);
      await runUserDelete('user_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('user_123');
    });
  });
});
