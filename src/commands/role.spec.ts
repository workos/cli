import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  authorization: {
    listEnvironmentRoles: vi.fn(),
    listOrganizationRoles: vi.fn(),
    getEnvironmentRole: vi.fn(),
    getOrganizationRole: vi.fn(),
    createEnvironmentRole: vi.fn(),
    createOrganizationRole: vi.fn(),
    updateEnvironmentRole: vi.fn(),
    updateOrganizationRole: vi.fn(),
    deleteOrganizationRole: vi.fn(),
    setEnvironmentRolePermissions: vi.fn(),
    setOrganizationRolePermissions: vi.fn(),
    addEnvironmentRolePermission: vi.fn(),
    addOrganizationRolePermission: vi.fn(),
    removeOrganizationRolePermission: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const {
  runRoleList,
  runRoleGet,
  runRoleCreate,
  runRoleUpdate,
  runRoleDelete,
  runRoleSetPermissions,
  runRoleAddPermission,
  runRoleRemovePermission,
} = await import('./role.js');

const mockEnvRole = {
  id: 'role_123',
  slug: 'admin',
  name: 'Admin',
  description: 'Administrator role',
  type: 'EnvironmentRole',
  permissions: ['read-users', 'write-users'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

const mockOrgRole = {
  id: 'role_456',
  slug: 'org-admin',
  name: 'Org Admin',
  description: 'Organization admin role',
  type: 'OrganizationRole',
  permissions: ['manage-members'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('role commands', () => {
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

  describe('runRoleList', () => {
    it('lists environment roles in table format', async () => {
      mockSdk.authorization.listEnvironmentRoles.mockResolvedValue({
        data: [mockEnvRole],
      });
      await runRoleList(undefined, 'sk_test');
      expect(mockSdk.authorization.listEnvironmentRoles).toHaveBeenCalled();
      expect(mockSdk.authorization.listOrganizationRoles).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('admin'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('Admin'))).toBe(true);
    });

    it('lists organization roles when orgId provided', async () => {
      mockSdk.authorization.listOrganizationRoles.mockResolvedValue({
        data: [mockOrgRole],
      });
      await runRoleList('org_abc', 'sk_test');
      expect(mockSdk.authorization.listOrganizationRoles).toHaveBeenCalledWith('org_abc');
      expect(mockSdk.authorization.listEnvironmentRoles).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('org-admin'))).toBe(true);
    });

    it('handles empty results', async () => {
      mockSdk.authorization.listEnvironmentRoles.mockResolvedValue({ data: [] });
      await runRoleList(undefined, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No roles found'))).toBe(true);
    });

    it('displays type and permissions count in table', async () => {
      mockSdk.authorization.listEnvironmentRoles.mockResolvedValue({
        data: [mockEnvRole],
      });
      await runRoleList(undefined, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('EnvironmentRole'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('2'))).toBe(true);
    });
  });

  describe('runRoleGet', () => {
    it('gets environment role by slug', async () => {
      mockSdk.authorization.getEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleGet('admin', undefined, 'sk_test');
      expect(mockSdk.authorization.getEnvironmentRole).toHaveBeenCalledWith('admin');
      expect(consoleOutput.some((l) => l.includes('role_123'))).toBe(true);
    });

    it('gets organization role by slug and orgId', async () => {
      mockSdk.authorization.getOrganizationRole.mockResolvedValue(mockOrgRole);
      await runRoleGet('org-admin', 'org_abc', 'sk_test');
      expect(mockSdk.authorization.getOrganizationRole).toHaveBeenCalledWith('org_abc', 'org-admin');
      expect(consoleOutput.some((l) => l.includes('role_456'))).toBe(true);
    });
  });

  describe('runRoleCreate', () => {
    it('creates environment role', async () => {
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleCreate({ slug: 'admin', name: 'Admin' }, undefined, 'sk_test');
      expect(mockSdk.authorization.createEnvironmentRole).toHaveBeenCalledWith({
        slug: 'admin',
        name: 'Admin',
      });
    });

    it('creates organization role when orgId provided', async () => {
      mockSdk.authorization.createOrganizationRole.mockResolvedValue(mockOrgRole);
      await runRoleCreate({ slug: 'org-admin', name: 'Org Admin' }, 'org_abc', 'sk_test');
      expect(mockSdk.authorization.createOrganizationRole).toHaveBeenCalledWith('org_abc', {
        slug: 'org-admin',
        name: 'Org Admin',
      });
    });

    it('includes description when provided', async () => {
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleCreate({ slug: 'admin', name: 'Admin', description: 'Desc' }, undefined, 'sk_test');
      expect(mockSdk.authorization.createEnvironmentRole).toHaveBeenCalledWith({
        slug: 'admin',
        name: 'Admin',
        description: 'Desc',
      });
    });

    it('outputs created message', async () => {
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleCreate({ slug: 'admin', name: 'Admin' }, undefined, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created role'))).toBe(true);
    });
  });

  describe('runRoleUpdate', () => {
    it('updates environment role', async () => {
      mockSdk.authorization.updateEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleUpdate('admin', { name: 'Updated Admin' }, undefined, 'sk_test');
      expect(mockSdk.authorization.updateEnvironmentRole).toHaveBeenCalledWith('admin', { name: 'Updated Admin' });
    });

    it('updates organization role when orgId provided', async () => {
      mockSdk.authorization.updateOrganizationRole.mockResolvedValue(mockOrgRole);
      await runRoleUpdate('org-admin', { name: 'Updated' }, 'org_abc', 'sk_test');
      expect(mockSdk.authorization.updateOrganizationRole).toHaveBeenCalledWith('org_abc', 'org-admin', {
        name: 'Updated',
      });
    });

    it('sends only provided fields', async () => {
      mockSdk.authorization.updateEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleUpdate('admin', { description: 'New desc' }, undefined, 'sk_test');
      expect(mockSdk.authorization.updateEnvironmentRole).toHaveBeenCalledWith('admin', { description: 'New desc' });
    });
  });

  describe('runRoleDelete', () => {
    it('deletes organization role', async () => {
      mockSdk.authorization.deleteOrganizationRole.mockResolvedValue(undefined);
      await runRoleDelete('org-admin', 'org_abc', 'sk_test');
      expect(mockSdk.authorization.deleteOrganizationRole).toHaveBeenCalledWith('org_abc', 'org-admin');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
    });

    it('outputs confirmation with slug and org ID', async () => {
      mockSdk.authorization.deleteOrganizationRole.mockResolvedValue(undefined);
      await runRoleDelete('org-admin', 'org_abc', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('org-admin'))).toBe(true);
    });
  });

  describe('runRoleSetPermissions', () => {
    it('sets environment role permissions', async () => {
      mockSdk.authorization.setEnvironmentRolePermissions.mockResolvedValue(mockEnvRole);
      await runRoleSetPermissions('admin', ['read', 'write'], undefined, 'sk_test');
      expect(mockSdk.authorization.setEnvironmentRolePermissions).toHaveBeenCalledWith('admin', {
        permissions: ['read', 'write'],
      });
    });

    it('sets organization role permissions', async () => {
      mockSdk.authorization.setOrganizationRolePermissions.mockResolvedValue(mockOrgRole);
      await runRoleSetPermissions('org-admin', ['manage'], 'org_abc', 'sk_test');
      expect(mockSdk.authorization.setOrganizationRolePermissions).toHaveBeenCalledWith('org_abc', 'org-admin', {
        permissions: ['manage'],
      });
    });

    it('outputs success message', async () => {
      mockSdk.authorization.setEnvironmentRolePermissions.mockResolvedValue(mockEnvRole);
      await runRoleSetPermissions('admin', ['read'], undefined, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Set permissions on role'))).toBe(true);
    });
  });

  describe('runRoleAddPermission', () => {
    it('adds permission to environment role', async () => {
      mockSdk.authorization.addEnvironmentRolePermission.mockResolvedValue(mockEnvRole);
      await runRoleAddPermission('admin', 'read-users', undefined, 'sk_test');
      expect(mockSdk.authorization.addEnvironmentRolePermission).toHaveBeenCalledWith('admin', {
        permissionSlug: 'read-users',
      });
    });

    it('adds permission to organization role', async () => {
      mockSdk.authorization.addOrganizationRolePermission.mockResolvedValue(mockOrgRole);
      await runRoleAddPermission('org-admin', 'manage', 'org_abc', 'sk_test');
      expect(mockSdk.authorization.addOrganizationRolePermission).toHaveBeenCalledWith('org_abc', 'org-admin', {
        permissionSlug: 'manage',
      });
    });
  });

  describe('runRoleRemovePermission', () => {
    it('removes permission from organization role', async () => {
      mockSdk.authorization.removeOrganizationRolePermission.mockResolvedValue(undefined);
      await runRoleRemovePermission('org-admin', 'manage', 'org_abc', 'sk_test');
      expect(mockSdk.authorization.removeOrganizationRolePermission).toHaveBeenCalledWith('org_abc', 'org-admin', {
        permissionSlug: 'manage',
      });
    });

    it('outputs confirmation', async () => {
      mockSdk.authorization.removeOrganizationRolePermission.mockResolvedValue(undefined);
      await runRoleRemovePermission('org-admin', 'manage', 'org_abc', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Removed permission from role'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runRoleCreate outputs JSON success', async () => {
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleCreate({ slug: 'admin', name: 'Admin' }, undefined, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Created role');
      expect(output.data.id).toBe('role_123');
    });

    it('runRoleGet outputs raw JSON for env role', async () => {
      mockSdk.authorization.getEnvironmentRole.mockResolvedValue(mockEnvRole);
      await runRoleGet('admin', undefined, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('role_123');
      expect(output.slug).toBe('admin');
      expect(output).not.toHaveProperty('status');
    });

    it('runRoleGet outputs raw JSON for org role', async () => {
      mockSdk.authorization.getOrganizationRole.mockResolvedValue(mockOrgRole);
      await runRoleGet('org-admin', 'org_abc', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('role_456');
      expect(output.type).toBe('OrganizationRole');
    });

    it('runRoleList outputs JSON with data array', async () => {
      mockSdk.authorization.listEnvironmentRoles.mockResolvedValue({
        data: [mockEnvRole],
      });
      await runRoleList(undefined, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].slug).toBe('admin');
    });

    it('runRoleList outputs empty data array for no results', async () => {
      mockSdk.authorization.listEnvironmentRoles.mockResolvedValue({ data: [] });
      await runRoleList(undefined, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
    });

    it('runRoleDelete outputs JSON success', async () => {
      mockSdk.authorization.deleteOrganizationRole.mockResolvedValue(undefined);
      await runRoleDelete('org-admin', 'org_abc', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.slug).toBe('org-admin');
    });

    it('runRoleSetPermissions outputs JSON success', async () => {
      mockSdk.authorization.setEnvironmentRolePermissions.mockResolvedValue(mockEnvRole);
      await runRoleSetPermissions('admin', ['read'], undefined, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Set permissions on role');
    });
  });
});
