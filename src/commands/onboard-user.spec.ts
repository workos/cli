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
    vi.useFakeTimers();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

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

  it('does not poll when --wait is not set', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });

    await runOnboardUser({ email: 'alice@acme.com', org: 'org_123' }, 'sk_test');

    expect(mockSdk.userManagement.getInvitation).not.toHaveBeenCalled();
  });

  it('polls invitation status when --wait is set until accepted', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });
    mockSdk.userManagement.getInvitation
      .mockResolvedValueOnce({ id: 'inv_123', state: 'pending' })
      .mockResolvedValueOnce({ id: 'inv_123', state: 'accepted' });

    const promise = runOnboardUser({ email: 'alice@acme.com', org: 'org_123', wait: true }, 'sk_test');
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockSdk.userManagement.getInvitation).toHaveBeenCalledTimes(2);
    expect(consoleOutput.some((l) => l.includes('accepted'))).toBe(true);
  });

  it('stops polling when invitation is revoked', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });
    mockSdk.userManagement.getInvitation.mockResolvedValueOnce({ id: 'inv_123', state: 'revoked' });

    const promise = runOnboardUser({ email: 'alice@acme.com', org: 'org_123', wait: true }, 'sk_test');
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(mockSdk.userManagement.getInvitation).toHaveBeenCalledTimes(1);
    expect(consoleOutput.some((l) => l.includes('revoked'))).toBe(true);
  });

  it('stops polling when invitation is expired', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });
    mockSdk.userManagement.getInvitation.mockResolvedValueOnce({ id: 'inv_123', state: 'expired' });

    const promise = runOnboardUser({ email: 'alice@acme.com', org: 'org_123', wait: true }, 'sk_test');
    await vi.advanceTimersByTimeAsync(5000);
    await promise;

    expect(consoleOutput.some((l) => l.includes('expired'))).toBe(true);
  });

  it('prints human-mode summary with invitation details', async () => {
    mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });

    await runOnboardUser({ email: 'alice@acme.com', org: 'org_123', role: 'admin' }, 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Onboarding summary'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('inv_123'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('admin'))).toBe(true);
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs JSON summary with invitation ID', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });

      await runOnboardUser({ email: 'alice@acme.com', org: 'org_123' }, 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.invitationId).toBe('inv_123');
    });

    it('includes acceptance status when --wait resolves', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue({ id: 'inv_123', state: 'pending' });
      mockSdk.userManagement.getInvitation.mockResolvedValueOnce({ id: 'inv_123', state: 'accepted' });

      const promise = runOnboardUser({ email: 'alice@acme.com', org: 'org_123', wait: true }, 'sk_test');
      await vi.advanceTimersByTimeAsync(5000);
      await promise;

      const output = JSON.parse(consoleOutput[0]);
      expect(output.invitationAccepted).toBe(true);
    });
  });
});
