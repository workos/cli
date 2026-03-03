import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  organizationDomains: {
    get: vi.fn(),
    create: vi.fn(),
    verify: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runOrgDomainGet, runOrgDomainCreate, runOrgDomainVerify, runOrgDomainDelete } = await import('./org-domain.js');

const mockDomain = {
  id: 'org_domain_123',
  domain: 'example.com',
  organizationId: 'org_456',
  state: 'verified',
  verificationStrategy: 'dns',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('org-domain commands', () => {
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

  describe('runOrgDomainGet', () => {
    it('fetches domain by ID', async () => {
      mockSdk.organizationDomains.get.mockResolvedValue(mockDomain);
      await runOrgDomainGet('org_domain_123', 'sk_test');
      expect(mockSdk.organizationDomains.get).toHaveBeenCalledWith('org_domain_123');
      expect(consoleOutput.some((l) => l.includes('org_domain_123'))).toBe(true);
    });
  });

  describe('runOrgDomainCreate', () => {
    it('creates domain with correct params', async () => {
      mockSdk.organizationDomains.create.mockResolvedValue(mockDomain);
      await runOrgDomainCreate('example.com', 'org_456', 'sk_test');
      expect(mockSdk.organizationDomains.create).toHaveBeenCalledWith({
        domain: 'example.com',
        organizationId: 'org_456',
      });
    });

    it('outputs success message', async () => {
      mockSdk.organizationDomains.create.mockResolvedValue(mockDomain);
      await runOrgDomainCreate('example.com', 'org_456', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created organization domain'))).toBe(true);
    });
  });

  describe('runOrgDomainVerify', () => {
    it('verifies domain by ID', async () => {
      mockSdk.organizationDomains.verify.mockResolvedValue(mockDomain);
      await runOrgDomainVerify('org_domain_123', 'sk_test');
      expect(mockSdk.organizationDomains.verify).toHaveBeenCalledWith('org_domain_123');
    });

    it('outputs success message', async () => {
      mockSdk.organizationDomains.verify.mockResolvedValue(mockDomain);
      await runOrgDomainVerify('org_domain_123', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Verified organization domain'))).toBe(true);
    });
  });

  describe('runOrgDomainDelete', () => {
    it('deletes domain by ID', async () => {
      mockSdk.organizationDomains.delete.mockResolvedValue(undefined);
      await runOrgDomainDelete('org_domain_123', 'sk_test');
      expect(mockSdk.organizationDomains.delete).toHaveBeenCalledWith('org_domain_123');
    });

    it('outputs deletion confirmation', async () => {
      mockSdk.organizationDomains.delete.mockResolvedValue(undefined);
      await runOrgDomainDelete('org_domain_123', 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('org_domain_123'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('runOrgDomainGet outputs raw JSON', async () => {
      mockSdk.organizationDomains.get.mockResolvedValue(mockDomain);
      await runOrgDomainGet('org_domain_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('org_domain_123');
      expect(output.domain).toBe('example.com');
    });

    it('runOrgDomainCreate outputs JSON success', async () => {
      mockSdk.organizationDomains.create.mockResolvedValue(mockDomain);
      await runOrgDomainCreate('example.com', 'org_456', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('org_domain_123');
    });

    it('runOrgDomainDelete outputs JSON success', async () => {
      mockSdk.organizationDomains.delete.mockResolvedValue(undefined);
      await runOrgDomainDelete('org_domain_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('org_domain_123');
    });
  });
});
