import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  userManagement: {
    sendInvitation: vi.fn(),
    getInvitation: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { runOnboardUser } = await import('./onboard-user.js');

describe('onboard-user command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('sends invitation with email and org', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });

    await runOnboardUser({ email: 'alice@acme.com', org: 'org_123' }, 'sk_test');

    expect(mockSdk.userManagement.sendInvitation).toHaveBeenCalledWith({
      email: 'alice@acme.com',
      organizationId: 'org_123',
    });
    expect(consoleOutput.some((l) => l.includes('inv_123'))).toBe(true);
  });

  it('sends invitation with role', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });

    await runOnboardUser({ email: 'alice@acme.com', org: 'org_123', role: 'admin' }, 'sk_test');

    expect(mockSdk.userManagement.sendInvitation).toHaveBeenCalledWith(expect.objectContaining({ roleSlug: 'admin' }));
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs JSON summary', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });

      await runOnboardUser({ email: 'alice@acme.com', org: 'org_123' }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.invitationId).toBe('inv_123');
    });
  });
});
