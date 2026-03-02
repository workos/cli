import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  userManagement: {
    listOrganizationMemberships: vi.fn(),
    getOrganizationMembership: vi.fn(),
    createOrganizationMembership: vi.fn(),
    updateOrganizationMembership: vi.fn(),
    deleteOrganizationMembership: vi.fn(),
    deactivateOrganizationMembership: vi.fn(),
    reactivateOrganizationMembership: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const {
  runMembershipList,
  runMembershipGet,
  runMembershipCreate,
  runMembershipUpdate,
  runMembershipDelete,
  runMembershipDeactivate,
  runMembershipReactivate,
} = await import('./membership.js');

const mockMembership = {
  id: 'om_123',
  userId: 'user_456',
  organizationId: 'org_789',
  organizationName: 'FooCorp',
  role: { slug: 'admin' },
  status: 'active',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  customAttributes: {},
};

describe('membership commands', () => {
  let consoleOutput: string[];
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runMembershipList', () => {
    it('lists memberships by org', async () => {
      mockSdk.userManagement.listOrganizationMemberships.mockResolvedValue({
        data: [mockMembership],
        listMetadata: { before: null, after: null },
      });
      await runMembershipList({ org: 'org_789' }, 'sk_test');
      expect(mockSdk.userManagement.listOrganizationMemberships).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_789' }),
      );
      expect(consoleOutput.some((l) => l.includes('om_123'))).toBe(true);
    });

    it('lists memberships by user', async () => {
      mockSdk.userManagement.listOrganizationMemberships.mockResolvedValue({
        data: [mockMembership],
        listMetadata: { before: null, after: null },
      });
      await runMembershipList({ user: 'user_456' }, 'sk_test');
      expect(mockSdk.userManagement.listOrganizationMemberships).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user_456' }),
      );
    });

    it('exits with error when neither --org nor --user provided', async () => {
      await runMembershipList({}, 'sk_test');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('handles empty results', async () => {
      mockSdk.userManagement.listOrganizationMemberships.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runMembershipList({ org: 'org_789' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No memberships found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.userManagement.listOrganizationMemberships.mockResolvedValue({
        data: [mockMembership],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runMembershipList({ org: 'org_789' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runMembershipGet', () => {
    it('fetches and prints membership as JSON', async () => {
      mockSdk.userManagement.getOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipGet('om_123', 'sk_test');
      expect(mockSdk.userManagement.getOrganizationMembership).toHaveBeenCalledWith('om_123');
      expect(consoleOutput.some((l) => l.includes('om_123'))).toBe(true);
    });
  });

  describe('runMembershipCreate', () => {
    it('creates membership with org and user', async () => {
      mockSdk.userManagement.createOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipCreate({ org: 'org_789', user: 'user_456' }, 'sk_test');
      expect(mockSdk.userManagement.createOrganizationMembership).toHaveBeenCalledWith({
        organizationId: 'org_789',
        userId: 'user_456',
      });
    });

    it('creates membership with role', async () => {
      mockSdk.userManagement.createOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipCreate({ org: 'org_789', user: 'user_456', role: 'admin' }, 'sk_test');
      expect(mockSdk.userManagement.createOrganizationMembership).toHaveBeenCalledWith({
        organizationId: 'org_789',
        userId: 'user_456',
        roleSlug: 'admin',
      });
    });

    it('outputs created message', async () => {
      mockSdk.userManagement.createOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipCreate({ org: 'org_789', user: 'user_456' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created membership'))).toBe(true);
    });
  });

  describe('runMembershipUpdate', () => {
    it('updates membership role', async () => {
      mockSdk.userManagement.updateOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipUpdate('om_123', 'editor', 'sk_test');
      expect(mockSdk.userManagement.updateOrganizationMembership).toHaveBeenCalledWith('om_123', {
        roleSlug: 'editor',
      });
    });
  });

  describe('runMembershipDelete', () => {
    it('deletes membership and prints confirmation', async () => {
      mockSdk.userManagement.deleteOrganizationMembership.mockResolvedValue(undefined);
      await runMembershipDelete('om_123', 'sk_test');
      expect(mockSdk.userManagement.deleteOrganizationMembership).toHaveBeenCalledWith('om_123');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('om_123'))).toBe(true);
    });
  });

  describe('runMembershipDeactivate', () => {
    it('deactivates membership', async () => {
      const deactivated = { ...mockMembership, status: 'inactive' };
      mockSdk.userManagement.deactivateOrganizationMembership.mockResolvedValue(deactivated);
      await runMembershipDeactivate('om_123', 'sk_test');
      expect(mockSdk.userManagement.deactivateOrganizationMembership).toHaveBeenCalledWith('om_123');
      expect(consoleOutput.some((l) => l.includes('Deactivated membership'))).toBe(true);
    });
  });

  describe('runMembershipReactivate', () => {
    it('reactivates membership', async () => {
      mockSdk.userManagement.reactivateOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipReactivate('om_123', 'sk_test');
      expect(mockSdk.userManagement.reactivateOrganizationMembership).toHaveBeenCalledWith('om_123');
      expect(consoleOutput.some((l) => l.includes('Reactivated membership'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runMembershipGet outputs raw JSON', async () => {
      mockSdk.userManagement.getOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipGet('om_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('om_123');
      expect(output).not.toHaveProperty('status', 'ok');
    });

    it('runMembershipList outputs JSON with data and listMetadata', async () => {
      mockSdk.userManagement.listOrganizationMemberships.mockResolvedValue({
        data: [mockMembership],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runMembershipList({ org: 'org_789' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('om_123');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runMembershipList outputs empty data array for no results', async () => {
      mockSdk.userManagement.listOrganizationMemberships.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runMembershipList({ org: 'org_789' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runMembershipCreate outputs JSON success', async () => {
      mockSdk.userManagement.createOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipCreate({ org: 'org_789', user: 'user_456' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Created membership');
      expect(output.data.id).toBe('om_123');
    });

    it('runMembershipUpdate outputs JSON success', async () => {
      mockSdk.userManagement.updateOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipUpdate('om_123', 'admin', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('om_123');
    });

    it('runMembershipDelete outputs JSON success', async () => {
      mockSdk.userManagement.deleteOrganizationMembership.mockResolvedValue(undefined);
      await runMembershipDelete('om_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('om_123');
    });

    it('runMembershipDeactivate outputs JSON success', async () => {
      const deactivated = { ...mockMembership, status: 'inactive' };
      mockSdk.userManagement.deactivateOrganizationMembership.mockResolvedValue(deactivated);
      await runMembershipDeactivate('om_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Deactivated membership');
    });

    it('runMembershipReactivate outputs JSON success', async () => {
      mockSdk.userManagement.reactivateOrganizationMembership.mockResolvedValue(mockMembership);
      await runMembershipReactivate('om_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Reactivated membership');
    });
  });
});
