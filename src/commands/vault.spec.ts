import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  vault: {
    listObjects: vi.fn(),
    readObject: vi.fn(),
    readObjectByName: vi.fn(),
    createObject: vi.fn(),
    updateObject: vi.fn(),
    deleteObject: vi.fn(),
    describeObject: vi.fn(),
    listObjectVersions: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const {
  runVaultList,
  runVaultGet,
  runVaultGetByName,
  runVaultCreate,
  runVaultUpdate,
  runVaultDelete,
  runVaultDescribe,
  runVaultListVersions,
} = await import('./vault.js');

const mockDigest = { id: 'obj_123', name: 'my-secret', updatedAt: '2024-01-01T00:00:00Z' };
const mockObject = { id: 'obj_123', name: 'my-secret', value: 'secret-value', metadata: {} };
const mockMetadata = {
  id: 'obj_123',
  context: {},
  environmentId: 'env_1',
  keyId: 'key_1',
  updatedAt: '2024-01-01',
  updatedBy: 'user',
  versionId: 'v1',
};

describe('vault commands', () => {
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

  describe('runVaultList', () => {
    it('lists objects in table', async () => {
      mockSdk.vault.listObjects.mockResolvedValue({
        data: [mockDigest],
        listMetadata: { before: null, after: null },
      });
      await runVaultList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('obj_123'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('my-secret'))).toBe(true);
    });

    it('passes pagination params', async () => {
      mockSdk.vault.listObjects.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runVaultList({ limit: 10, order: 'asc' }, 'sk_test');
      expect(mockSdk.vault.listObjects).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, order: 'asc' }));
    });

    it('handles empty results', async () => {
      mockSdk.vault.listObjects.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runVaultList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No vault objects found'))).toBe(true);
    });
  });

  describe('runVaultGet', () => {
    it('returns metadata only by default', async () => {
      mockSdk.vault.describeObject.mockResolvedValue({ id: 'obj_123', name: 'my-secret', metadata: {} });
      await runVaultGet('obj_123', false, 'sk_test');
      expect(mockSdk.vault.describeObject).toHaveBeenCalledWith({ id: 'obj_123' });
      expect(mockSdk.vault.readObject).not.toHaveBeenCalled();
      const output = consoleOutput.join('');
      expect(output).not.toMatch(/secret-value/);
    });

    it('includes decrypted value with --decrypt', async () => {
      mockSdk.vault.readObject.mockResolvedValue(mockObject);
      await runVaultGet('obj_123', true, 'sk_test');
      expect(mockSdk.vault.readObject).toHaveBeenCalledWith({ id: 'obj_123' });
      expect(consoleOutput.some((l) => l.includes('secret-value'))).toBe(true);
    });
  });

  describe('runVaultGetByName', () => {
    it('strips value by default', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValue(mockObject);
      await runVaultGetByName('my-secret', false, 'sk_test');
      expect(mockSdk.vault.readObjectByName).toHaveBeenCalledWith('my-secret');
      const output = consoleOutput.join('');
      expect(output).toMatch(/obj_123/);
      expect(output).not.toMatch(/secret-value/);
    });

    it('includes value with --decrypt', async () => {
      mockSdk.vault.readObjectByName.mockResolvedValue(mockObject);
      await runVaultGetByName('my-secret', true, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('secret-value'))).toBe(true);
    });
  });

  describe('runVaultCreate', () => {
    it('creates object with org context', async () => {
      mockSdk.vault.createObject.mockResolvedValue(mockMetadata);
      await runVaultCreate({ name: 'my-secret', value: 'secret-val', org: 'org_456' }, 'sk_test');
      expect(mockSdk.vault.createObject).toHaveBeenCalledWith({
        name: 'my-secret',
        value: 'secret-val',
        context: { organizationId: 'org_456' },
      });
      expect(consoleOutput.some((l) => l.includes('Created vault object'))).toBe(true);
    });

    it('exits with error when --org is not provided', async () => {
      const errOutput: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
        errOutput.push(args.map(String).join(' '));
      });
      await expect(runVaultCreate({ name: 'my-secret', value: 'secret-val' }, 'sk_test')).rejects.toThrow();
      expect(errOutput.some((l) => l.includes('--org'))).toBe(true);
    });
  });

  describe('runVaultUpdate', () => {
    it('updates object with id and value', async () => {
      mockSdk.vault.updateObject.mockResolvedValue(mockObject);
      await runVaultUpdate({ id: 'obj_123', value: 'new-value' }, 'sk_test');
      expect(mockSdk.vault.updateObject).toHaveBeenCalledWith({ id: 'obj_123', value: 'new-value' });
    });

    it('passes versionCheck when provided', async () => {
      mockSdk.vault.updateObject.mockResolvedValue(mockObject);
      await runVaultUpdate({ id: 'obj_123', value: 'new-value', versionCheck: 'v1' }, 'sk_test');
      expect(mockSdk.vault.updateObject).toHaveBeenCalledWith({
        id: 'obj_123',
        value: 'new-value',
        versionCheck: 'v1',
      });
    });
  });

  describe('runVaultDelete', () => {
    it('deletes object by ID', async () => {
      mockSdk.vault.deleteObject.mockResolvedValue(undefined);
      await runVaultDelete('obj_123', 'sk_test');
      expect(mockSdk.vault.deleteObject).toHaveBeenCalledWith({ id: 'obj_123' });
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
    });
  });

  describe('runVaultDescribe', () => {
    it('describes object by ID', async () => {
      mockSdk.vault.describeObject.mockResolvedValue(mockObject);
      await runVaultDescribe('obj_123', 'sk_test');
      expect(mockSdk.vault.describeObject).toHaveBeenCalledWith({ id: 'obj_123' });
    });
  });

  describe('runVaultListVersions', () => {
    it('lists versions by object ID', async () => {
      const versions = [{ id: 'v1', createdAt: '2024-01-01', currentVersion: true }];
      mockSdk.vault.listObjectVersions.mockResolvedValue(versions);
      await runVaultListVersions('obj_123', 'sk_test');
      expect(mockSdk.vault.listObjectVersions).toHaveBeenCalledWith({ id: 'obj_123' });
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('list outputs { data, listMetadata }', async () => {
      mockSdk.vault.listObjects.mockResolvedValue({
        data: [mockDigest],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runVaultList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('get --decrypt outputs value in JSON', async () => {
      mockSdk.vault.readObject.mockResolvedValue(mockObject);
      await runVaultGet('obj_123', true, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('obj_123');
      expect(output.value).toBe('secret-value');
    });

    it('create outputs JSON success', async () => {
      mockSdk.vault.createObject.mockResolvedValue(mockMetadata);
      await runVaultCreate({ name: 'my-secret', value: 'val', org: 'org_456' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('obj_123');
    });

    it('delete outputs JSON success', async () => {
      mockSdk.vault.deleteObject.mockResolvedValue(undefined);
      await runVaultDelete('obj_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('obj_123');
    });
  });
});
