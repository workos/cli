import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  authorization: {
    listPermissions: vi.fn(),
    getPermission: vi.fn(),
    createPermission: vi.fn(),
    updatePermission: vi.fn(),
    deletePermission: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runPermissionList, runPermissionGet, runPermissionCreate, runPermissionUpdate, runPermissionDelete } =
  await import('./permission.js');

describe('permission commands', () => {
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

  describe('runPermissionList', () => {
    it('lists permissions in table format', async () => {
      mockSdk.authorization.listPermissions.mockResolvedValue({
        data: [
          {
            id: 'perm_123',
            slug: 'read-users',
            name: 'Read Users',
            description: 'Can read user data',
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        listMetadata: { before: null, after: null },
      });
      await runPermissionList({}, 'sk_test');
      expect(mockSdk.authorization.listPermissions).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('read-users'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('Read Users'))).toBe(true);
    });

    it('passes pagination params', async () => {
      mockSdk.authorization.listPermissions.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runPermissionList({ limit: 5, order: 'desc', after: 'cursor_a' }, 'sk_test');
      expect(mockSdk.authorization.listPermissions).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, order: 'desc', after: 'cursor_a' }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.authorization.listPermissions.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runPermissionList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No permissions found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.authorization.listPermissions.mockResolvedValue({
        data: [
          {
            id: 'perm_1',
            slug: 'read',
            name: 'Read',
            description: null,
            createdAt: '2024-01-01T00:00:00Z',
          },
        ],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runPermissionList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runPermissionGet', () => {
    it('fetches and prints permission as JSON', async () => {
      mockSdk.authorization.getPermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
        description: 'Can read user data',
      });
      await runPermissionGet('read-users', 'sk_test');
      expect(mockSdk.authorization.getPermission).toHaveBeenCalledWith('read-users');
      expect(consoleOutput.some((l) => l.includes('perm_123'))).toBe(true);
    });
  });

  describe('runPermissionCreate', () => {
    it('creates permission with slug and name', async () => {
      mockSdk.authorization.createPermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
      });
      await runPermissionCreate({ slug: 'read-users', name: 'Read Users' }, 'sk_test');
      expect(mockSdk.authorization.createPermission).toHaveBeenCalledWith({
        slug: 'read-users',
        name: 'Read Users',
      });
    });

    it('includes description when provided', async () => {
      mockSdk.authorization.createPermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
      });
      await runPermissionCreate({ slug: 'read-users', name: 'Read Users', description: 'Desc' }, 'sk_test');
      expect(mockSdk.authorization.createPermission).toHaveBeenCalledWith({
        slug: 'read-users',
        name: 'Read Users',
        description: 'Desc',
      });
    });

    it('outputs created message', async () => {
      mockSdk.authorization.createPermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
      });
      await runPermissionCreate({ slug: 'read-users', name: 'Read Users' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created permission'))).toBe(true);
    });
  });

  describe('runPermissionUpdate', () => {
    it('updates permission with provided fields', async () => {
      mockSdk.authorization.updatePermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Updated Name',
      });
      await runPermissionUpdate('read-users', { name: 'Updated Name' }, 'sk_test');
      expect(mockSdk.authorization.updatePermission).toHaveBeenCalledWith('read-users', { name: 'Updated Name' });
    });

    it('sends only provided fields', async () => {
      mockSdk.authorization.updatePermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
        description: 'New desc',
      });
      await runPermissionUpdate('read-users', { description: 'New desc' }, 'sk_test');
      expect(mockSdk.authorization.updatePermission).toHaveBeenCalledWith('read-users', { description: 'New desc' });
    });
  });

  describe('runPermissionDelete', () => {
    it('deletes permission and prints confirmation', async () => {
      mockSdk.authorization.deletePermission.mockResolvedValue(undefined);
      await runPermissionDelete('read-users', 'sk_test');
      expect(mockSdk.authorization.deletePermission).toHaveBeenCalledWith('read-users');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('read-users'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runPermissionCreate outputs JSON success', async () => {
      mockSdk.authorization.createPermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
      });
      await runPermissionCreate({ slug: 'read-users', name: 'Read Users' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Created permission');
      expect(output.data.id).toBe('perm_123');
    });

    it('runPermissionGet outputs raw JSON', async () => {
      mockSdk.authorization.getPermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Read Users',
      });
      await runPermissionGet('read-users', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('perm_123');
      expect(output.slug).toBe('read-users');
      expect(output).not.toHaveProperty('status');
    });

    it('runPermissionList outputs JSON with data and listMetadata', async () => {
      mockSdk.authorization.listPermissions.mockResolvedValue({
        data: [{ id: 'perm_123', slug: 'read-users', name: 'Read Users' }],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runPermissionList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('perm_123');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runPermissionList outputs empty data array for no results', async () => {
      mockSdk.authorization.listPermissions.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runPermissionList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runPermissionUpdate outputs JSON success', async () => {
      mockSdk.authorization.updatePermission.mockResolvedValue({
        id: 'perm_123',
        slug: 'read-users',
        name: 'Updated',
      });
      await runPermissionUpdate('read-users', { name: 'Updated' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.name).toBe('Updated');
    });

    it('runPermissionDelete outputs JSON success', async () => {
      mockSdk.authorization.deletePermission.mockResolvedValue(undefined);
      await runPermissionDelete('read-users', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.slug).toBe('read-users');
    });
  });
});
