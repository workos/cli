import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  organizations: {
    createOrganization: vi.fn(),
    updateOrganization: vi.fn(),
    getOrganization: vi.fn(),
    listOrganizations: vi.fn(),
    deleteOrganization: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runOrgCreate, runOrgUpdate, runOrgGet, runOrgList, runOrgDelete, parseDomainArgs } =
  await import('./organization.js');

describe('organization commands', () => {
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

  describe('parseDomainArgs', () => {
    it('parses domain:state format', () => {
      expect(parseDomainArgs(['foo.com:verified'])).toEqual([{ domain: 'foo.com', state: 'verified' }]);
    });

    it('defaults state to verified', () => {
      expect(parseDomainArgs(['foo.com'])).toEqual([{ domain: 'foo.com', state: 'verified' }]);
    });

    it('parses multiple domains', () => {
      const result = parseDomainArgs(['foo.com:verified', 'bar.com:pending']);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ domain: 'bar.com', state: 'pending' });
    });

    it('returns empty array for no args', () => {
      expect(parseDomainArgs([])).toEqual([]);
    });
  });

  describe('runOrgCreate', () => {
    it('creates org with name only', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', [], 'sk_test');
      expect(mockSdk.organizations.createOrganization).toHaveBeenCalledWith({ name: 'Test' });
    });

    it('creates org with domain data', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', ['foo.com:pending'], 'sk_test');
      expect(mockSdk.organizations.createOrganization).toHaveBeenCalledWith({
        name: 'Test',
        domainData: [{ domain: 'foo.com', state: 'pending' }],
      });
    });

    it('outputs created message and JSON', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', [], 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created organization'))).toBe(true);
    });
  });

  describe('runOrgUpdate', () => {
    it('updates org name', async () => {
      mockSdk.organizations.updateOrganization.mockResolvedValue({ id: 'org_123', name: 'Updated' });
      await runOrgUpdate('org_123', 'Updated', 'sk_test');
      expect(mockSdk.organizations.updateOrganization).toHaveBeenCalledWith({
        organization: 'org_123',
        name: 'Updated',
      });
    });

    it('updates org with domain data', async () => {
      mockSdk.organizations.updateOrganization.mockResolvedValue({ id: 'org_123', name: 'Updated' });
      await runOrgUpdate('org_123', 'Updated', 'sk_test', 'foo.com', 'pending');
      expect(mockSdk.organizations.updateOrganization).toHaveBeenCalledWith({
        organization: 'org_123',
        name: 'Updated',
        domainData: [{ domain: 'foo.com', state: 'pending' }],
      });
    });
  });

  describe('runOrgGet', () => {
    it('fetches and prints org as JSON', async () => {
      mockSdk.organizations.getOrganization.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgGet('org_123', 'sk_test');
      expect(mockSdk.organizations.getOrganization).toHaveBeenCalledWith('org_123');
      expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
    });
  });

  describe('runOrgList', () => {
    it('lists orgs in table format', async () => {
      mockSdk.organizations.listOrganizations.mockResolvedValue({
        data: [
          {
            id: 'org_123',
            name: 'FooCorp',
            domains: [{ id: 'd_1', domain: 'foo.com', state: 'verified' }],
          },
        ],
        listMetadata: { before: null, after: null },
      });
      await runOrgList({}, 'sk_test');
      expect(mockSdk.organizations.listOrganizations).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('FooCorp'))).toBe(true);
    });

    it('passes filter params', async () => {
      mockSdk.organizations.listOrganizations.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runOrgList({ domain: 'foo.com', limit: 5, order: 'desc' }, 'sk_test');
      expect(mockSdk.organizations.listOrganizations).toHaveBeenCalledWith(
        expect.objectContaining({ domains: ['foo.com'], limit: 5, order: 'desc' }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.organizations.listOrganizations.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runOrgList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No organizations found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.organizations.listOrganizations.mockResolvedValue({
        data: [{ id: 'org_1', name: 'Test', domains: [] }],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runOrgList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runOrgDelete', () => {
    it('deletes org and prints confirmation', async () => {
      mockSdk.organizations.deleteOrganization.mockResolvedValue(undefined);
      await runOrgDelete('org_123', 'sk_test');
      expect(mockSdk.organizations.deleteOrganization).toHaveBeenCalledWith('org_123');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runOrgCreate outputs JSON success', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', [], 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Created organization');
      expect(output.data.id).toBe('org_123');
    });

    it('runOrgGet outputs raw JSON', async () => {
      mockSdk.organizations.getOrganization.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgGet('org_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('org_123');
      expect(output.name).toBe('Test');
      expect(output).not.toHaveProperty('status');
    });

    it('runOrgList outputs JSON with data and listMetadata', async () => {
      mockSdk.organizations.listOrganizations.mockResolvedValue({
        data: [{ id: 'org_123', name: 'FooCorp', domains: [] }],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runOrgList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('org_123');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runOrgList outputs empty data array for no results', async () => {
      mockSdk.organizations.listOrganizations.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runOrgList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runOrgDelete outputs JSON success', async () => {
      mockSdk.organizations.deleteOrganization.mockResolvedValue(undefined);
      await runOrgDelete('org_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('org_123');
    });
  });
});
