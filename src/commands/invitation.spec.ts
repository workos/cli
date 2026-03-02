import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  userManagement: {
    listInvitations: vi.fn(),
    getInvitation: vi.fn(),
    sendInvitation: vi.fn(),
    revokeInvitation: vi.fn(),
    resendInvitation: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');

const { runInvitationList, runInvitationGet, runInvitationSend, runInvitationRevoke, runInvitationResend } =
  await import('./invitation.js');

const mockInvitation = {
  id: 'inv_123',
  email: 'test@example.com',
  state: 'pending',
  organizationId: 'org_789',
  expiresAt: '2024-02-01T00:00:00Z',
  acceptedAt: null,
  revokedAt: null,
  inviterUserId: null,
  acceptedUserId: null,
  token: 'tok_abc',
  acceptInvitationUrl: 'https://example.com/accept',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('invitation commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runInvitationList', () => {
    it('lists invitations', async () => {
      mockSdk.userManagement.listInvitations.mockResolvedValue({
        data: [mockInvitation],
        listMetadata: { before: null, after: null },
      });
      await runInvitationList({}, 'sk_test');
      expect(mockSdk.userManagement.listInvitations).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('test@example.com'))).toBe(true);
    });

    it('passes org filter', async () => {
      mockSdk.userManagement.listInvitations.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runInvitationList({ org: 'org_789' }, 'sk_test');
      expect(mockSdk.userManagement.listInvitations).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_789' }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.userManagement.listInvitations.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runInvitationList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No invitations found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.userManagement.listInvitations.mockResolvedValue({
        data: [mockInvitation],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runInvitationList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runInvitationGet', () => {
    it('fetches and prints invitation as JSON', async () => {
      mockSdk.userManagement.getInvitation.mockResolvedValue(mockInvitation);
      await runInvitationGet('inv_123', 'sk_test');
      expect(mockSdk.userManagement.getInvitation).toHaveBeenCalledWith('inv_123');
      expect(consoleOutput.some((l) => l.includes('inv_123'))).toBe(true);
    });
  });

  describe('runInvitationSend', () => {
    it('sends invitation with email', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue(mockInvitation);
      await runInvitationSend({ email: 'test@example.com' }, 'sk_test');
      expect(mockSdk.userManagement.sendInvitation).toHaveBeenCalledWith({
        email: 'test@example.com',
      });
    });

    it('sends invitation with all options', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue(mockInvitation);
      await runInvitationSend(
        { email: 'test@example.com', org: 'org_789', role: 'admin', expiresInDays: 7 },
        'sk_test',
      );
      expect(mockSdk.userManagement.sendInvitation).toHaveBeenCalledWith({
        email: 'test@example.com',
        organizationId: 'org_789',
        roleSlug: 'admin',
        expiresInDays: 7,
      });
    });

    it('outputs sent message', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue(mockInvitation);
      await runInvitationSend({ email: 'test@example.com' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Sent invitation'))).toBe(true);
    });
  });

  describe('runInvitationRevoke', () => {
    it('revokes invitation', async () => {
      const revoked = { ...mockInvitation, state: 'revoked' };
      mockSdk.userManagement.revokeInvitation.mockResolvedValue(revoked);
      await runInvitationRevoke('inv_123', 'sk_test');
      expect(mockSdk.userManagement.revokeInvitation).toHaveBeenCalledWith('inv_123');
      expect(consoleOutput.some((l) => l.includes('Revoked invitation'))).toBe(true);
    });
  });

  describe('runInvitationResend', () => {
    it('resends invitation', async () => {
      mockSdk.userManagement.resendInvitation.mockResolvedValue(mockInvitation);
      await runInvitationResend('inv_123', 'sk_test');
      expect(mockSdk.userManagement.resendInvitation).toHaveBeenCalledWith('inv_123');
      expect(consoleOutput.some((l) => l.includes('Resent invitation'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runInvitationGet outputs raw JSON', async () => {
      mockSdk.userManagement.getInvitation.mockResolvedValue(mockInvitation);
      await runInvitationGet('inv_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('inv_123');
      expect(output).not.toHaveProperty('status', 'ok');
    });

    it('runInvitationList outputs JSON with data and listMetadata', async () => {
      mockSdk.userManagement.listInvitations.mockResolvedValue({
        data: [mockInvitation],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runInvitationList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('inv_123');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runInvitationList outputs empty data array for no results', async () => {
      mockSdk.userManagement.listInvitations.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runInvitationList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runInvitationSend outputs JSON success', async () => {
      mockSdk.userManagement.sendInvitation.mockResolvedValue(mockInvitation);
      await runInvitationSend({ email: 'test@example.com' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Sent invitation');
      expect(output.data.id).toBe('inv_123');
    });

    it('runInvitationRevoke outputs JSON success', async () => {
      const revoked = { ...mockInvitation, state: 'revoked' };
      mockSdk.userManagement.revokeInvitation.mockResolvedValue(revoked);
      await runInvitationRevoke('inv_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Revoked invitation');
    });

    it('runInvitationResend outputs JSON success', async () => {
      mockSdk.userManagement.resendInvitation.mockResolvedValue(mockInvitation);
      await runInvitationResend('inv_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Resent invitation');
    });
  });
});
