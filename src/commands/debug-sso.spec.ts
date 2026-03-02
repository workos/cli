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

  it('displays connection details', async () => {
    mockSdk.sso.getConnection.mockResolvedValue({
      id: 'conn_123',
      name: 'Okta SSO',
      type: 'OktaSAML',
      state: 'active',
      organizationId: 'org_123',
      createdAt: '2024-01-01',
    });
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    expect(mockSdk.sso.getConnection).toHaveBeenCalledWith('conn_123');
    expect(consoleOutput.some((l) => l.includes('Okta SSO'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('active'))).toBe(true);
  });

  it('identifies inactive connection', async () => {
    mockSdk.sso.getConnection.mockResolvedValue({
      id: 'conn_123',
      name: 'Broken SSO',
      type: 'OktaSAML',
      state: 'inactive',
      organizationId: 'org_123',
      createdAt: '2024-01-01',
    });
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSso('conn_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('not active'))).toBe(true);
  });

  it('shows recent auth events', async () => {
    mockSdk.sso.getConnection.mockResolvedValue({
      id: 'conn_123',
      name: 'SSO',
      type: 'OktaSAML',
      state: 'active',
      organizationId: null,
      createdAt: '2024-01-01',
    });
    mockSdk.events.listEvents.mockResolvedValue({
      data: [{ id: 'evt_1', event: 'authentication.sso_succeeded', createdAt: '2024-01-02' }],
      listMetadata: {},
    });

    await runDebugSso('conn_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('sso_succeeded'))).toBe(true);
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs full diagnosis as JSON', async () => {
      mockSdk.sso.getConnection.mockResolvedValue({
        id: 'conn_123',
        name: 'SSO',
        type: 'OktaSAML',
        state: 'inactive',
        organizationId: 'org_123',
        createdAt: '2024-01-01',
      });
      mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

      await runDebugSso('conn_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.connection.id).toBe('conn_123');
      expect(output.issues).toContain('Connection is inactive (not active)');
    });
  });
});
