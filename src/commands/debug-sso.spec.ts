import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  sso: { getConnection: vi.fn() },
  events: { listEvents: vi.fn() },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { runDebugSso } = await import('./debug-sso.js');

describe('debug-sso command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  const activeConnection = {
    id: 'conn_123',
    name: 'Okta SSO',
    type: 'OktaSAML',
    state: 'active',
    organizationId: 'org_123',
    createdAt: '2024-01-01',
  };

  const inactiveConnection = {
    ...activeConnection,
    name: 'Broken SSO',
    state: 'inactive',
  };

  it('displays connection details', async () => {
    mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    expect(mockSdk.sso.getConnection).toHaveBeenCalledWith('conn_123');
    expect(consoleOutput.some((l) => l.includes('Okta SSO'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('OktaSAML'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
  });

  it('reports no issues for active connection', async () => {
    mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('No issues detected'))).toBe(true);
  });

  it('identifies inactive connection as an issue', async () => {
    mockSdk.sso.getConnection.mockResolvedValue(inactiveConnection);
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('not active'))).toBe(true);
  });

  it('shows recent auth events', async () => {
    mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
    mockSdk.events.listEvents.mockResolvedValue({
      data: [
        { id: 'evt_1', event: 'authentication.sso_succeeded', createdAt: '2024-01-02' },
        { id: 'evt_2', event: 'authentication.email_verification_succeeded', createdAt: '2024-01-03' },
      ],
      listMetadata: {},
    });

    await runDebugSso('conn_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('sso_succeeded'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('email_verification_succeeded'))).toBe(true);
  });

  it('handles event listing failure gracefully', async () => {
    mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
    mockSdk.events.listEvents.mockRejectedValue(new Error('Events not available'));

    await runDebugSso('conn_123', 'sk_test');

    // Should still complete without crashing
    expect(consoleOutput.some((l) => l.includes('Okta SSO'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('No recent'))).toBe(true);
  });

  it('filters events by organizationId when connection has one', async () => {
    mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    expect(mockSdk.events.listEvents).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_123' }));
  });

  it('does not filter by org when connection has no organizationId', async () => {
    mockSdk.sso.getConnection.mockResolvedValue({ ...activeConnection, organizationId: null });
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    const callArgs = mockSdk.events.listEvents.mock.calls[0][0];
    expect(callArgs).not.toHaveProperty('organizationId');
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs connection details as JSON', async () => {
      mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
      mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

      await runDebugSso('conn_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.connection.id).toBe('conn_123');
      expect(output.connection.name).toBe('Okta SSO');
      expect(output.connection.type).toBe('OktaSAML');
      expect(output.connection.state).toBe('active');
      expect(output.recentEvents).toEqual([]);
      expect(output.issues).toEqual([]);
    });

    it('includes issues in JSON for inactive connection', async () => {
      mockSdk.sso.getConnection.mockResolvedValue(inactiveConnection);
      mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

      await runDebugSso('conn_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.issues).toContain('Connection is inactive (not active)');
    });

    it('includes events in JSON', async () => {
      mockSdk.sso.getConnection.mockResolvedValue(activeConnection);
      mockSdk.events.listEvents.mockResolvedValue({
        data: [{ id: 'evt_1', event: 'authentication.sso_succeeded', createdAt: '2024-01-02' }],
        listMetadata: {},
      });

      await runDebugSso('conn_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.recentEvents).toHaveLength(1);
      expect(output.recentEvents[0].event).toBe('authentication.sso_succeeded');
    });
  });
});
