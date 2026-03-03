import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  organizations: { createOrganization: vi.fn() },
  organizationDomains: { create: vi.fn(), verify: vi.fn() },
  authorization: { createOrganizationRole: vi.fn() },
  portal: { generateLink: vi.fn() },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { runSetupOrg } = await import('./setup-org.js');

describe('setup-org command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('creates org with name', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    await runSetupOrg({ name: 'Acme' }, 'sk_test');
    expect(mockSdk.organizations.createOrganization).toHaveBeenCalledWith({ name: 'Acme' });
    expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
  });

  it('adds and verifies domain when provided', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.organizationDomains.create.mockResolvedValue({ id: 'dom_1' });
    mockSdk.organizationDomains.verify.mockResolvedValue({ id: 'dom_1', state: 'verified' });

    await runSetupOrg({ name: 'Acme', domain: 'acme.com' }, 'sk_test');

    expect(mockSdk.organizationDomains.create).toHaveBeenCalledWith({ domain: 'acme.com', organizationId: 'org_123' });
    expect(mockSdk.organizationDomains.verify).toHaveBeenCalledWith('dom_1');
  });

  it('creates org-scoped roles when provided', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.authorization.createOrganizationRole.mockResolvedValue({ slug: 'admin' });

    await runSetupOrg({ name: 'Acme', roles: ['admin', 'viewer'] }, 'sk_test');

    expect(mockSdk.authorization.createOrganizationRole).toHaveBeenCalledTimes(2);
    expect(mockSdk.authorization.createOrganizationRole).toHaveBeenCalledWith('org_123', {
      slug: 'admin',
      name: 'admin',
    });
  });

  it('generates portal link', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/xxx' });

    await runSetupOrg({ name: 'Acme' }, 'sk_test');

    expect(mockSdk.portal.generateLink).toHaveBeenCalledWith(expect.objectContaining({ organization: 'org_123' }));
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs JSON summary', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/xxx' });

      await runSetupOrg({ name: 'Acme' }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.organizationId).toBe('org_123');
    });
  });
});
