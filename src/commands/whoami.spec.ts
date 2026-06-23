import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockGetAccessToken = vi.fn();
const mockGraphqlRequest = vi.fn();

vi.mock('../lib/credentials.js', () => ({
  getAccessToken: () => mockGetAccessToken(),
}));

// Replace only the request function; keep the real DashboardGraphqlError so the
// command's `instanceof` check matches what the tests throw.
vi.mock('../lib/dashboard-graphql.js', async (importActual) => {
  const actual = await importActual<typeof import('../lib/dashboard-graphql.js')>();
  return {
    ...actual,
    dashboardGraphqlRequest: (...args: unknown[]) => mockGraphqlRequest(...args),
  };
});

const { setOutputMode } = await import('../utils/output.js');
const { DashboardGraphqlError } = await import('../lib/dashboard-graphql.js');
const { CliExit } = await import('../utils/cli-exit.js');
const { runWhoami } = await import('./whoami.js');

function sampleData() {
  return {
    me: { id: 'usr_dash_1', name: 'Nick Nisi', email: 'nick.nisi@workos.com', workosUserId: 'user_123' },
    currentTeam: { id: 'team_1', name: 'WorkOS', organizationId: 'org_123', productionState: 'Live' },
    currentEnvironment: { id: 'env_1', name: 'Production', clientId: 'client_123', platform: 'Node', sandbox: false },
  };
}

describe('whoami command', () => {
  let consoleOutput: string[];
  let consoleErrors: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    consoleErrors = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits auth-required (code 4) when not logged in', async () => {
    mockGetAccessToken.mockReturnValue(null);
    await expect(runWhoami()).rejects.toMatchObject({ name: 'CliExit', exitCode: 4 });
    expect(mockGraphqlRequest).not.toHaveBeenCalled();
  });

  it('calls the dashboard GraphQL API with the bearer token', async () => {
    mockGetAccessToken.mockReturnValue('tok_123');
    mockGraphqlRequest.mockResolvedValue(sampleData());
    await runWhoami();
    expect(mockGraphqlRequest).toHaveBeenCalledWith(expect.stringContaining('workosCliWhoami'), { token: 'tok_123' });
  });

  it('renders user, team, and environment in human mode', async () => {
    mockGetAccessToken.mockReturnValue('tok');
    mockGraphqlRequest.mockResolvedValue(sampleData());
    await runWhoami();
    const out = consoleOutput.join('\n');
    expect(out).toContain('nick.nisi@workos.com');
    expect(out).toContain('WorkOS');
    expect(out).toContain('org_123');
    expect(out).toContain('Production');
    expect(out).toContain('client_123');
  });

  it('omits the team and environment blocks when absent', async () => {
    mockGetAccessToken.mockReturnValue('tok');
    mockGraphqlRequest.mockResolvedValue({ ...sampleData(), currentTeam: null, currentEnvironment: null });
    await runWhoami();
    const out = consoleOutput.join('\n');
    expect(out).toContain('User');
    expect(out).not.toContain('Team');
    expect(out).not.toContain('Environment');
  });

  it('explains the gated-capability case on a 403', async () => {
    mockGetAccessToken.mockReturnValue('tok');
    mockGraphqlRequest.mockRejectedValue(
      new DashboardGraphqlError('The dashboard GraphQL API rejected this session (HTTP 403).', 'forbidden', 403),
    );
    await expect(runWhoami()).rejects.toBeInstanceOf(CliExit);
    const err = consoleErrors.join('\n');
    expect(err).toContain('staging only');
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('outputs user/team/environment as JSON', async () => {
      mockGetAccessToken.mockReturnValue('tok');
      mockGraphqlRequest.mockResolvedValue(sampleData());
      await runWhoami();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.user.email).toBe('nick.nisi@workos.com');
      expect(output.user.workosUserId).toBe('user_123');
      expect(output.team.organizationId).toBe('org_123');
      expect(output.environment.clientId).toBe('client_123');
    });

    it('preserves null team/environment in JSON', async () => {
      mockGetAccessToken.mockReturnValue('tok');
      mockGraphqlRequest.mockResolvedValue({ ...sampleData(), currentTeam: null, currentEnvironment: null });
      await runWhoami();
      const output = JSON.parse(consoleOutput[0]);
      expect(output.team).toBeNull();
      expect(output.environment).toBeNull();
    });
  });
});
