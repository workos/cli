import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

const mockSdk = {
  authorization: {
    createPermission: vi.fn(),
    deletePermission: vi.fn(),
    createEnvironmentRole: vi.fn(),
    setEnvironmentRolePermissions: vi.fn(),
  },
  organizations: {
    createOrganization: vi.fn(),
    deleteOrganization: vi.fn(),
  },
};

const mockExtensions = {
  redirectUris: { add: vi.fn() },
  corsOrigins: { add: vi.fn() },
  homepageUrl: { set: vi.fn() },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk, ...mockExtensions }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { runSeed } = await import('./seed.js');

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

const SEED_YAML = `
organizations:
  - name: "Test Org"
    domains: ["test.com"]
permissions:
  - name: "Read Users"
    slug: "read-users"
roles:
  - name: "Admin"
    slug: "admin"
    permissions: ["read-users"]
config:
  redirect_uris: ["http://localhost:3000/callback"]
  cors_origins: ["http://localhost:3000"]
  homepage_url: "http://localhost:3000"
`;

describe('seed command', () => {
  let consoleOutput: string[];
  let consoleErrors: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    consoleErrors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runSeed with --file', () => {
    it('creates resources in dependency order', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(SEED_YAML);
      mockSdk.authorization.createPermission.mockResolvedValue({ slug: 'read-users' });
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue({ slug: 'admin' });
      mockSdk.authorization.setEnvironmentRolePermissions.mockResolvedValue({});
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Test Org' });
      mockExtensions.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: false });
      mockExtensions.corsOrigins.add.mockResolvedValue({ success: true, alreadyExists: false });
      mockExtensions.homepageUrl.set.mockResolvedValue(undefined);

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      // Verify order: permissions first
      expect(mockSdk.authorization.createPermission).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'read-users' }),
      );
      // Then roles
      expect(mockSdk.authorization.createEnvironmentRole).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'admin' }),
      );
      // Then permission assignment
      expect(mockSdk.authorization.setEnvironmentRolePermissions).toHaveBeenCalledWith('admin', {
        permissions: ['read-users'],
      });
      // Then orgs
      expect(mockSdk.organizations.createOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Test Org' }),
      );
      // Then config
      expect(mockExtensions.redirectUris.add).toHaveBeenCalledWith('http://localhost:3000/callback');
      expect(mockExtensions.corsOrigins.add).toHaveBeenCalledWith('http://localhost:3000');
      expect(mockExtensions.homepageUrl.set).toHaveBeenCalledWith('http://localhost:3000');

      // State file written
      expect(mockWriteFileSync).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('Seed complete'))).toBe(true);
    });

    it('skips already-existing resources', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
permissions:
  - name: "Existing"
    slug: "existing"
`);
      mockSdk.authorization.createPermission.mockRejectedValue(new Error('already exists'));

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('exists'))).toBe(true);
    });

    it('exits with error when file not found', async () => {
      mockExistsSync.mockReturnValue(false);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      await runSeed({ file: 'missing.yml' }, 'sk_test');
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('runSeed --clean', () => {
    it('deletes resources in reverse order', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          permissions: [{ slug: 'read-users' }],
          roles: [{ slug: 'admin' }],
          organizations: [{ id: 'org_123', name: 'Test Org' }],
          createdAt: '2024-01-01',
        }),
      );
      mockSdk.organizations.deleteOrganization.mockResolvedValue(undefined);
      mockSdk.authorization.deletePermission.mockResolvedValue(undefined);

      await runSeed({ clean: true }, 'sk_test');

      // Orgs deleted first (reverse of creation order)
      expect(mockSdk.organizations.deleteOrganization).toHaveBeenCalledWith('org_123');
      // Permissions deleted
      expect(mockSdk.authorization.deletePermission).toHaveBeenCalledWith('read-users');
      // State file removed
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('exits with error when no state file', async () => {
      mockExistsSync.mockReturnValue(false);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      await runSeed({ clean: true }, 'sk_test');
      expect(mockExit).toHaveBeenCalledWith(1);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs JSON status on success', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
permissions:
  - name: "Test"
    slug: "test"
`);
      mockSdk.authorization.createPermission.mockResolvedValue({ slug: 'test' });

      await runSeed({ file: 'seed.yml' }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.state.permissions).toHaveLength(1);
    });
  });
});
