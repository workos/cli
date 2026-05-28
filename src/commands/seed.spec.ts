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
const { runSeed, runSeedInit } = await import('./seed.js');
const { CliExit } = await import('../utils/cli-exit.js');

const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockUnlinkSync = vi.mocked(unlinkSync);

const FULL_SEED_YAML = `
organizations:
  - name: "Test Org"
    domains: ["test.com"]
permissions:
  - name: "Read Users"
    slug: "read-users"
  - name: "Write Users"
    slug: "write-users"
roles:
  - name: "Admin"
    slug: "admin"
    permissions: ["read-users", "write-users"]
  - name: "Viewer"
    slug: "viewer"
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

  afterEach(() => vi.restoreAllMocks());

  describe('runSeedInit (--init)', () => {
    it('creates workos-seed.yml with example content', () => {
      mockExistsSync.mockReturnValue(false);

      runSeedInit();

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
      const [filePath, content] = mockWriteFileSync.mock.calls[0];
      expect(filePath).toBe('workos-seed.yml');
      expect(content).toContain('permissions:');
      expect(content).toContain('roles:');
      expect(content).toContain('organizations:');
      expect(content).toContain('config:');
      expect(content).toContain('redirect_uris:');
      expect(consoleOutput.some((l) => l.includes('Created'))).toBe(true);
    });

    it('does not overwrite existing file', () => {
      mockExistsSync.mockReturnValue(true);

      runSeedInit();

      expect(mockWriteFileSync).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('already exists'))).toBe(true);
    });

    it('outputs JSON when in JSON mode', () => {
      setOutputMode('json');
      mockExistsSync.mockReturnValue(false);

      runSeedInit();

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.file).toBe('workos-seed.yml');
      setOutputMode('human');
    });

    it('is reachable via runSeed({ init: true })', async () => {
      mockExistsSync.mockReturnValue(false);

      await runSeed({ init: true }, 'sk_test');

      expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
      const [filePath] = mockWriteFileSync.mock.calls[0];
      expect(filePath).toBe('workos-seed.yml');
    });
  });

  describe('runSeed with --file', () => {
    it('creates resources in dependency order: permissions → roles → orgs → config', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(FULL_SEED_YAML);
      mockSdk.authorization.createPermission.mockResolvedValue({ slug: 'read-users' });
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue({ slug: 'admin' });
      mockSdk.authorization.setEnvironmentRolePermissions.mockResolvedValue({});
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Test Org' });
      mockExtensions.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: false });
      mockExtensions.corsOrigins.add.mockResolvedValue({ success: true, alreadyExists: false });
      mockExtensions.homepageUrl.set.mockResolvedValue(undefined);

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      // Permissions created first
      expect(mockSdk.authorization.createPermission).toHaveBeenCalledTimes(2);
      expect(mockSdk.authorization.createPermission).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'read-users' }),
      );
      expect(mockSdk.authorization.createPermission).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'write-users' }),
      );

      // Then roles
      expect(mockSdk.authorization.createEnvironmentRole).toHaveBeenCalledTimes(2);

      // Then permission assignments
      expect(mockSdk.authorization.setEnvironmentRolePermissions).toHaveBeenCalledWith('admin', {
        permissions: ['read-users', 'write-users'],
      });
      expect(mockSdk.authorization.setEnvironmentRolePermissions).toHaveBeenCalledWith('viewer', {
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
      const stateArg = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(stateArg.permissions).toHaveLength(2);
      expect(stateArg.roles).toHaveLength(2);
      expect(stateArg.organizations).toHaveLength(1);
    });

    it('skips already-existing permissions without failing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
permissions:
  - name: "Existing"
    slug: "existing"
`);
      mockSdk.authorization.createPermission.mockRejectedValue(new Error('already exists'));

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('exists'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('Seed complete'))).toBe(true);
    });

    it('skips already-existing roles without failing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
roles:
  - name: "Existing"
    slug: "existing"
`);
      mockSdk.authorization.createEnvironmentRole.mockRejectedValue(new Error('conflict'));

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('exists'))).toBe(true);
    });

    it('skips already-existing orgs without failing', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
organizations:
  - name: "Existing Org"
`);
      mockSdk.organizations.createOrganization.mockRejectedValue(new Error('duplicate'));

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('exist'))).toBe(true);
    });

    it('handles permission assignment failure gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
roles:
  - name: "Admin"
    slug: "admin"
    permissions: ["nonexistent"]
`);
      mockSdk.authorization.createEnvironmentRole.mockResolvedValue({ slug: 'admin' });
      mockSdk.authorization.setEnvironmentRolePermissions.mockRejectedValue(new Error('Permission not found'));

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('Warning') || l.includes('Failed to set permissions'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('Seed complete'))).toBe(true);
    });

    it('handles config with already-existing URIs', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(`
config:
  redirect_uris: ["http://localhost:3000/callback"]
`);
      mockExtensions.redirectUris.add.mockResolvedValue({ success: true, alreadyExists: true });

      await runSeed({ file: 'workos-seed.yml' }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('exists'))).toBe(true);
    });

    it('saves partial state on failure', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(FULL_SEED_YAML);
      mockSdk.authorization.createPermission.mockResolvedValue({ slug: 'read-users' });
      mockSdk.authorization.createEnvironmentRole.mockRejectedValue(new Error('Server exploded'));

      await expect(runSeed({ file: 'workos-seed.yml' }, 'sk_test')).rejects.toThrow(CliExit);

      // State should be saved with the permission that was created
      expect(mockWriteFileSync).toHaveBeenCalled();
      const stateArg = JSON.parse(mockWriteFileSync.mock.calls[0][1] as string);
      expect(stateArg.permissions.length).toBeGreaterThan(0);
    });

    it('exits with error when file not found', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(runSeed({ file: 'missing.yml' }, 'sk_test')).rejects.toThrow(CliExit);
    });

    it('exits with error when no --file provided', async () => {
      await expect(runSeed({}, 'sk_test')).rejects.toThrow(CliExit);
    });

    it('exits with error on invalid YAML', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('{{{{invalid yaml');

      await expect(runSeed({ file: 'bad.yml' }, 'sk_test')).rejects.toThrow(CliExit);
    });
  });

  describe('runSeed --clean', () => {
    it('deletes resources in reverse order: orgs → permissions', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          permissions: [{ slug: 'read-users' }, { slug: 'write-users' }],
          roles: [{ slug: 'admin' }],
          organizations: [{ id: 'org_123', name: 'Test Org' }],
          createdAt: '2024-01-01',
        }),
      );
      mockSdk.organizations.deleteOrganization.mockResolvedValue(undefined);
      mockSdk.authorization.deletePermission.mockResolvedValue(undefined);

      await runSeed({ clean: true }, 'sk_test');

      expect(mockSdk.organizations.deleteOrganization).toHaveBeenCalledWith('org_123');
      expect(mockSdk.authorization.deletePermission).toHaveBeenCalledWith('write-users');
      expect(mockSdk.authorization.deletePermission).toHaveBeenCalledWith('read-users');
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('skips env roles (cannot be deleted)', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          permissions: [],
          roles: [{ slug: 'admin' }],
          organizations: [],
          createdAt: '2024-01-01',
        }),
      );

      await runSeed({ clean: true }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('skipped') || l.includes('cannot be deleted'))).toBe(true);
    });

    it('handles delete failures gracefully', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          permissions: [{ slug: 'stuck' }],
          roles: [],
          organizations: [{ id: 'org_stuck', name: 'Stuck Org' }],
          createdAt: '2024-01-01',
        }),
      );
      mockSdk.organizations.deleteOrganization.mockRejectedValue(new Error('Cannot delete'));
      mockSdk.authorization.deletePermission.mockRejectedValue(new Error('Cannot delete'));

      await runSeed({ clean: true }, 'sk_test');

      expect(consoleOutput.some((l) => l.includes('Warning'))).toBe(true);
      // Should still remove state file
      expect(mockUnlinkSync).toHaveBeenCalled();
    });

    it('exits with error when no state file', async () => {
      mockExistsSync.mockReturnValue(false);

      await expect(runSeed({ clean: true }, 'sk_test')).rejects.toThrow(CliExit);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs JSON status with state on seed success', async () => {
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
      expect(output.message).toBe('Seed complete');
      expect(output.state.permissions).toHaveLength(1);
    });

    it('outputs JSON success on clean', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ permissions: [], roles: [], organizations: [], createdAt: '2024-01-01' }),
      );

      await runSeed({ clean: true }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Seed cleanup complete');
    });
  });
});
