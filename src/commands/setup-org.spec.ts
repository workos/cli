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

  it('creates org with name only', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    await runSetupOrg({ name: 'Acme' }, 'sk_test');
    expect(mockSdk.organizations.createOrganization).toHaveBeenCalledWith({ name: 'Acme' });
    expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
  });

  it('does not call domain or role APIs when not provided', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    await runSetupOrg({ name: 'Acme' }, 'sk_test');
    expect(mockSdk.organizationDomains.create).not.toHaveBeenCalled();
    expect(mockSdk.authorization.createOrganizationRole).not.toHaveBeenCalled();
  });

  it('adds and verifies domain when provided', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.organizationDomains.create.mockResolvedValue({ id: 'dom_1' });
    mockSdk.organizationDomains.verify.mockResolvedValue({ id: 'dom_1', state: 'verified' });

    await runSetupOrg({ name: 'Acme', domain: 'acme.com' }, 'sk_test');

    expect(mockSdk.organizationDomains.create).toHaveBeenCalledWith({ domain: 'acme.com', organizationId: 'org_123' });
    expect(mockSdk.organizationDomains.verify).toHaveBeenCalledWith('dom_1');
    expect(consoleOutput.some((l) => l.includes('Verified domain'))).toBe(true);
  });

  it('handles domain verification failure gracefully', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.organizationDomains.create.mockResolvedValue({ id: 'dom_1' });
    mockSdk.organizationDomains.verify.mockRejectedValue(new Error('Verification pending'));

    await runSetupOrg({ name: 'Acme', domain: 'acme.com' }, 'sk_test');

    expect(consoleOutput.some((l) => l.includes('pending'))).toBe(true);
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
    expect(mockSdk.authorization.createOrganizationRole).toHaveBeenCalledWith('org_123', {
      slug: 'viewer',
      name: 'viewer',
    });
  });

  it('skips already-existing roles without failing', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.authorization.createOrganizationRole.mockRejectedValue(new Error('Role already exists'));

    await runSetupOrg({ name: 'Acme', roles: ['existing'] }, 'sk_test');

    expect(consoleOutput.some((l) => l.includes('exists') || l.includes('skipped'))).toBe(true);
  });

  it('handles role creation failure gracefully', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.authorization.createOrganizationRole.mockRejectedValue(new Error('Server error'));

    await runSetupOrg({ name: 'Acme', roles: ['bad'] }, 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Warning') || l.includes('Could not create'))).toBe(true);
  });

  it('generates portal link', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/xxx' });

    await runSetupOrg({ name: 'Acme' }, 'sk_test');

    expect(mockSdk.portal.generateLink).toHaveBeenCalledWith(expect.objectContaining({ organization: 'org_123' }));
    expect(consoleOutput.some((l) => l.includes('portal.workos.com'))).toBe(true);
  });

  it('handles portal link failure gracefully', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.portal.generateLink.mockRejectedValue(new Error('Plan upgrade required'));

    await runSetupOrg({ name: 'Acme' }, 'sk_test');

    expect(consoleOutput.some((l) => l.includes('skipped'))).toBe(true);
  });

  it('prints human-mode summary with all components', async () => {
    mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
    mockSdk.organizationDomains.create.mockResolvedValue({ id: 'dom_1' });
    mockSdk.organizationDomains.verify.mockResolvedValue({});
    mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/xxx' });

    await runSetupOrg({ name: 'Acme', domain: 'acme.com' }, 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Setup complete'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('acme.com'))).toBe(true);
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs JSON summary with org ID', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
      mockSdk.portal.generateLink.mockResolvedValue({ link: 'https://portal.workos.com/xxx' });

      await runSetupOrg({ name: 'Acme' }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.organizationId).toBe('org_123');
      expect(output.portalLink).toBe('https://portal.workos.com/xxx');
    });

    it('includes domain verification status in JSON', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
      mockSdk.organizationDomains.create.mockResolvedValue({ id: 'dom_1' });
      mockSdk.organizationDomains.verify.mockResolvedValue({});

      await runSetupOrg({ name: 'Acme', domain: 'acme.com' }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.domainId).toBe('dom_1');
      expect(output.domainVerified).toBe(true);
    });

    it('includes roles in JSON', async () => {
      mockSdk.organizations.createOrganization.mockResolvedValue({ id: 'org_123', name: 'Acme' });
      mockSdk.authorization.createOrganizationRole.mockResolvedValue({ slug: 'admin' });

      await runSetupOrg({ name: 'Acme', roles: ['admin'] }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.roles).toContain('admin');
    });
  });
});
