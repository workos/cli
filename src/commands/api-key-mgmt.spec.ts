import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  organizations: {
    listOrganizationApiKeys: vi.fn(),
    createOrganizationApiKey: vi.fn(),
  },
  apiKeys: {
    validateApiKey: vi.fn(),
    deleteApiKey: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runApiKeyList, runApiKeyCreate, runApiKeyValidate, runApiKeyDelete } = await import('./api-key-mgmt.js');

const mockApiKey = {
  object: 'api_key',
  id: 'key_123',
  name: 'My Key',
  obfuscatedValue: 'sk_test_...abc',
  owner: { type: 'organization', id: 'org_456' },
  permissions: [],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('api-key-mgmt commands', () => {
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

  describe('runApiKeyList', () => {
    it('lists keys in table', async () => {
      mockSdk.organizations.listOrganizationApiKeys.mockResolvedValue({
        data: [mockApiKey],
        listMetadata: { before: null, after: null },
      });
      await runApiKeyList({ organizationId: 'org_456' }, 'sk_test');
      expect(mockSdk.organizations.listOrganizationApiKeys).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_456' }),
      );
      expect(consoleOutput.some((l) => l.includes('key_123'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('My Key'))).toBe(true);
    });

    it('handles empty results', async () => {
      mockSdk.organizations.listOrganizationApiKeys.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runApiKeyList({ organizationId: 'org_456' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No API keys found'))).toBe(true);
    });

    it('passes pagination params', async () => {
      mockSdk.organizations.listOrganizationApiKeys.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runApiKeyList({ organizationId: 'org_456', limit: 5, order: 'desc' }, 'sk_test');
      expect(mockSdk.organizations.listOrganizationApiKeys).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5, order: 'desc' }),
      );
    });
  });

  describe('runApiKeyCreate', () => {
    it('creates API key with org and name', async () => {
      mockSdk.organizations.createOrganizationApiKey.mockResolvedValue({ ...mockApiKey, value: 'sk_test_full_key' });
      await runApiKeyCreate({ organizationId: 'org_456', name: 'My Key' }, 'sk_test');
      expect(mockSdk.organizations.createOrganizationApiKey).toHaveBeenCalledWith({
        organizationId: 'org_456',
        name: 'My Key',
      });
    });

    it('displays key value warning in human mode', async () => {
      mockSdk.organizations.createOrganizationApiKey.mockResolvedValue({ ...mockApiKey, value: 'sk_test_full_key' });
      await runApiKeyCreate({ organizationId: 'org_456', name: 'My Key' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created API key'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('sk_test_full_key'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('not be shown again'))).toBe(true);
    });

    it('passes permissions when provided', async () => {
      mockSdk.organizations.createOrganizationApiKey.mockResolvedValue({ ...mockApiKey, value: 'sk_test_full_key' });
      await runApiKeyCreate({ organizationId: 'org_456', name: 'My Key', permissions: ['read', 'write'] }, 'sk_test');
      expect(mockSdk.organizations.createOrganizationApiKey).toHaveBeenCalledWith({
        organizationId: 'org_456',
        name: 'My Key',
        permissions: ['read', 'write'],
      });
    });
  });

  describe('runApiKeyValidate', () => {
    it('validates API key', async () => {
      mockSdk.apiKeys.validateApiKey.mockResolvedValue({ apiKey: mockApiKey });
      await runApiKeyValidate('sk_test_value', 'sk_test');
      expect(mockSdk.apiKeys.validateApiKey).toHaveBeenCalledWith({ value: 'sk_test_value' });
      expect(consoleOutput.some((l) => l.includes('valid'))).toBe(true);
    });

    it('handles invalid key (null result)', async () => {
      mockSdk.apiKeys.validateApiKey.mockResolvedValue({ apiKey: null });
      await runApiKeyValidate('sk_test_invalid', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('invalid'))).toBe(true);
    });
  });

  describe('runApiKeyDelete', () => {
    it('deletes API key by ID', async () => {
      mockSdk.apiKeys.deleteApiKey.mockResolvedValue(undefined);
      await runApiKeyDelete('key_123', 'sk_test');
      expect(mockSdk.apiKeys.deleteApiKey).toHaveBeenCalledWith('key_123');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('list outputs { data, listMetadata }', async () => {
      mockSdk.organizations.listOrganizationApiKeys.mockResolvedValue({
        data: [mockApiKey],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runApiKeyList({ organizationId: 'org_456' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('key_123');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('create includes key value in output', async () => {
      mockSdk.organizations.createOrganizationApiKey.mockResolvedValue({ ...mockApiKey, value: 'sk_test_full_key' });
      await runApiKeyCreate({ organizationId: 'org_456', name: 'My Key' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.value).toBe('sk_test_full_key');
    });

    it('validate outputs raw JSON', async () => {
      mockSdk.apiKeys.validateApiKey.mockResolvedValue({ apiKey: mockApiKey });
      await runApiKeyValidate('sk_test_value', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.apiKey.id).toBe('key_123');
    });

    it('delete outputs JSON success', async () => {
      mockSdk.apiKeys.deleteApiKey.mockResolvedValue(undefined);
      await runApiKeyDelete('key_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('key_123');
    });
  });
});
