import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockRequireCommandToken = vi.fn();
const mockGraphqlRequest = vi.fn();
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);

vi.mock('../lib/command-auth.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/command-auth.js')>();
  return {
    ...actual,
    requireCommandToken: () => mockRequireCommandToken(),
  };
});

vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

vi.mock('../utils/ui.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
  },
}));

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');
const { CliExit } = await import('../utils/cli-exit.js');
const {
  runTeamMembers,
  runTeamInvite,
  runTeamChangeRole,
  runTeamRemove,
  runTeamResendInvite,
  runTeamUpdate,
  runTeamSetMfa,
} = await import('./team.js');

async function expectExit(promise: Promise<unknown>, code: number): Promise<CliExit> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof CliExit) {
      expect(err.exitCode).toBe(code);
      return err;
    }
    throw err;
  }
  throw new Error(`Expected CliExit(${code}) but promise resolved`);
}

describe('team command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
    mockRequireCommandToken.mockResolvedValue('tok_123');
    mockConfirm.mockReset();
    mockIsCancel.mockReset();
    mockIsCancel.mockReturnValue(false);
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetInteractionModeForTests();
    setOutputMode('human');
  });

  describe('members', () => {
    it('lists members in human mode', async () => {
      mockGraphqlRequest.mockResolvedValue({
        currentTeam: {
          memberships: [
            { id: 'uo_1', role: 'ADMIN', state: 'active', user: { id: 'u_1', name: 'Nick', email: 'nick@workos.com' } },
          ],
        },
      });
      await runTeamMembers();
      const out = consoleOutput.join('\n');
      expect(out).toContain('nick@workos.com');
      expect(out).toContain('ADMIN');
    });

    it('outputs JSON in json mode', async () => {
      setOutputMode('json');
      mockGraphqlRequest.mockResolvedValue({
        currentTeam: { memberships: [{ id: 'uo_1', role: 'ADMIN', state: 'active', user: null }] },
      });
      await runTeamMembers();
      const out = JSON.parse(consoleOutput[0]);
      expect(out.members[0].id).toBe('uo_1');
    });

    it('sends NO environment header (team-scoped operation)', async () => {
      mockGraphqlRequest.mockResolvedValue({ currentTeam: { memberships: [] } });
      await runTeamMembers();
      // Team-level ops must never carry an environment target — a spurious
      // header would be validated (and could be rejected) by the guard.
      expect(mockGraphqlRequest.mock.calls[0][1]).not.toHaveProperty('environmentId');
    });
  });

  describe('invite', () => {
    it('maps email + role (uppercased) into the nested user input', async () => {
      mockGraphqlRequest.mockResolvedValue({
        inviteUserToTeam: {
          __typename: 'UserInvitedToTeam',
          invitedMember: {
            id: 'uo_2',
            role: 'MEMBER',
            state: 'invited',
            user: { id: 'u_2', email: 'a@b.com', name: null },
          },
        },
      });
      await runTeamInvite({ email: 'a@b.com', role: 'member' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('inviteUserToTeam'), {
        token: 'tok_123',
        variables: { input: { user: { email: 'a@b.com', role: 'MEMBER' } } },
      });
    });

    it('rejects an invalid role with a usage error', async () => {
      const err = await expectExit(runTeamInvite({ email: 'a@b.com', role: 'wizard' }), 1);
      expect(err.context?.errorCode).toBe('invalid_role');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('errors when the user already belongs to the team', async () => {
      mockGraphqlRequest.mockResolvedValue({
        inviteUserToTeam: { __typename: 'UserAlreadyBelongsToCurrentTeam', email: 'a@b.com' },
      });
      const err = await expectExit(runTeamInvite({ email: 'a@b.com', role: 'MEMBER' }), 1);
      expect(err.context?.errorCode).toBe('already_member');
    });
  });

  describe('change-role (require-flag)', () => {
    it('refuses non-interactive without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      const err = await expectExit(runTeamChangeRole({ membershipId: 'uo_1', role: 'ADMIN', yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactive with --yes', async () => {
      setInteractionMode({ mode: 'agent', source: 'agent_env' });
      mockGraphqlRequest.mockResolvedValue({ changeRole: { id: 'uo_1', role: 'ADMIN' } });
      await runTeamChangeRole({ membershipId: 'uo_1', role: 'admin', yes: true });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('changeRole'), {
        token: 'tok_123',
        variables: { usersOrganizationsId: 'uo_1', role: 'ADMIN' },
      });
    });
  });

  describe('remove (destructive)', () => {
    it('refuses non-interactive without --yes (exit 1, confirmation_required)', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runTeamRemove({ membershipId: 'uo_1', yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactive with --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      mockGraphqlRequest.mockResolvedValue({ removeUserFromTeam: 'uo_1' });
      await runTeamRemove({ membershipId: 'uo_1', yes: true });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('removeUserFromTeam'), {
        token: 'tok_123',
        variables: { usersOrganizationsId: 'uo_1' },
      });
    });

    it('prompts interactively and proceeds when confirmed', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(true);
      mockGraphqlRequest.mockResolvedValue({ removeUserFromTeam: 'uo_1' });
      await runTeamRemove({ membershipId: 'uo_1', yes: false });
      expect(mockConfirm).toHaveBeenCalledOnce();
      expect(mockGraphqlRequest).toHaveBeenCalled();
    });

    it('cancels (exit 2) when the interactive prompt is declined', async () => {
      setInteractionMode({ mode: 'human', source: 'default' });
      mockConfirm.mockResolvedValue(false);
      await expectExit(runTeamRemove({ membershipId: 'uo_1', yes: false }), 2);
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });
  });

  describe('resend-invite', () => {
    it('proceeds on a resendable invite', async () => {
      mockGraphqlRequest.mockResolvedValue({
        resendDashboardInvite: { __typename: 'DashboardInviteResent', resentInvitation: true },
      });
      await runTeamResendInvite({ membershipId: 'uo_1' });
      expect(consoleOutput.join('\n')).toContain('uo_1');
    });

    it('errors when the invite has not expired', async () => {
      mockGraphqlRequest.mockResolvedValue({ resendDashboardInvite: { __typename: 'DashboardInviteNotExpired' } });
      const err = await expectExit(runTeamResendInvite({ membershipId: 'uo_1' }), 1);
      expect(err.context?.errorCode).toBe('invite_not_expired');
    });
  });

  describe('update', () => {
    it('maps name to the input and renders the new name', async () => {
      mockGraphqlRequest.mockResolvedValue({
        updateTeamDetails: { __typename: 'TeamDetailsUpdated', team: { id: 'team_1', name: 'New Co' } },
      });
      await runTeamUpdate({ name: 'New Co' });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('updateTeamDetails'), {
        token: 'tok_123',
        variables: { input: { name: 'New Co' } },
      });
      expect(consoleOutput.join('\n')).toContain('New Co');
    });

    it('errors on InvalidTeamName', async () => {
      mockGraphqlRequest.mockResolvedValue({
        updateTeamDetails: { __typename: 'InvalidTeamName', team: { id: 'team_1' } },
      });
      const err = await expectExit(runTeamUpdate({ name: '' }), 1);
      expect(err.context?.errorCode).toBe('invalid_team_name');
    });
  });

  describe('set-mfa (require-flag)', () => {
    it('refuses non-interactive without --yes', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      const err = await expectExit(runTeamSetMfa({ required: true, yes: false }), 1);
      expect(err.context?.errorCode).toBe('confirmation_required');
      expect(mockGraphqlRequest).not.toHaveBeenCalled();
    });

    it('proceeds non-interactive with --yes and maps requireMfa', async () => {
      setInteractionMode({ mode: 'ci', source: 'ci_env' });
      mockGraphqlRequest.mockResolvedValue({
        updateTeamMfaRequirement: {
          __typename: 'TeamMfaRequirementUpdated',
          team: { id: 'team_1', isMfaRequired: true },
        },
      });
      await runTeamSetMfa({ required: true, yes: true });
      expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('updateTeamMfaRequirement'), {
        token: 'tok_123',
        variables: { input: { requireMfa: true } },
      });
    });
  });
});
