import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  sso: {
    listConnections: vi.fn(),
    getConnection: vi.fn(),
    deleteConnection: vi.fn(),
  },
};

const mockConnections = {
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk, connections: mockConnections }),
}));

// Mock the UI facade
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);

vi.mock('../utils/ui.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
  },
}));

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');

const { runConnectionList, runConnectionGet, runConnectionDelete, runConnectionCreate, runConnectionUpdate } =
  await import('./connection.js');
const { CliExit } = await import('../utils/cli-exit.js');

const mockConnection = {
  id: 'conn_01ABC',
  name: 'Okta SSO',
  type: 'OktaSAML',
  organizationId: 'org_123',
  state: 'active',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
  domains: [],
};

const mockApiConnection = {
  object: 'connection',
  id: 'conn_01ABC',
  organization_id: 'org_123',
  name: 'Okta SSO',
  connection_type: 'GenericSAML',
  state: 'active',
  external_id: 'legacy-42',
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

describe('connection commands', () => {
  let consoleOutput: string[];
  let stderrOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    resetInteractionModeForTests();
    consoleOutput = [];
    stderrOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      stderrOutput.push(args.map(String).join(' '));
    });
    mockConfirm.mockResolvedValue(true);
    mockIsCancel.mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setOutputMode('human');
    resetInteractionModeForTests();
  });

  describe('runConnectionList', () => {
    it('lists connections in table format', async () => {
      mockSdk.sso.listConnections.mockResolvedValue({
        data: [mockConnection],
        listMetadata: { before: null, after: null },
      });
      await runConnectionList({}, 'sk_test');
      expect(mockSdk.sso.listConnections).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('Okta SSO'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('conn_01ABC'))).toBe(true);
    });

    it('passes filter params', async () => {
      mockSdk.sso.listConnections.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runConnectionList({ organizationId: 'org_123', connectionType: 'OktaSAML', limit: 5 }, 'sk_test');
      expect(mockSdk.sso.listConnections).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_123', connectionType: 'OktaSAML', limit: 5 }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.sso.listConnections.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runConnectionList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No connections found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.sso.listConnections.mockResolvedValue({
        data: [mockConnection],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runConnectionList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runConnectionGet', () => {
    it('fetches and prints connection', async () => {
      mockSdk.sso.getConnection.mockResolvedValue(mockConnection);
      await runConnectionGet('conn_01ABC', 'sk_test');
      expect(mockSdk.sso.getConnection).toHaveBeenCalledWith('conn_01ABC');
      expect(consoleOutput.some((l) => l.includes('conn_01ABC'))).toBe(true);
    });
  });

  describe('runConnectionCreate', () => {
    it('creates from flags', async () => {
      mockConnections.create.mockResolvedValue(mockApiConnection);
      await runConnectionCreate({ org: 'org_123', name: 'Okta SSO', externalId: 'legacy-42' }, 'sk_test');
      expect(mockConnections.create).toHaveBeenCalledWith({
        organization_id: 'org_123',
        name: 'Okta SSO',
        external_id: 'legacy-42',
      });
      expect(consoleOutput.some((l) => l.includes('Created connection'))).toBe(true);
    });

    it('creates from --data JSON body', async () => {
      mockConnections.create.mockResolvedValue(mockApiConnection);
      await runConnectionCreate(
        { data: '{"organization_id":"org_123","saml_options":{"idp_metadata_url":"https://idp.example.com/md"}}' },
        'sk_test',
      );
      expect(mockConnections.create).toHaveBeenCalledWith({
        organization_id: 'org_123',
        saml_options: { idp_metadata_url: 'https://idp.example.com/md' },
      });
    });

    it('flags override --data body fields', async () => {
      mockConnections.create.mockResolvedValue(mockApiConnection);
      await runConnectionCreate({ org: 'org_456', data: '{"organization_id":"org_123","name":"A"}' }, 'sk_test');
      expect(mockConnections.create).toHaveBeenCalledWith({ organization_id: 'org_456', name: 'A' });
    });

    it('requires an organization ID', async () => {
      await expect(runConnectionCreate({ name: 'Okta SSO' }, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockConnections.create).not.toHaveBeenCalled();
    });

    it('rejects invalid JSON in --data', async () => {
      await expect(runConnectionCreate({ org: 'org_123', data: 'not json' }, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockConnections.create).not.toHaveBeenCalled();
    });

    it('rejects a non-object JSON body', async () => {
      await expect(runConnectionCreate({ org: 'org_123', data: '[1,2]' }, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockConnections.create).not.toHaveBeenCalled();
    });
  });

  describe('runConnectionUpdate', () => {
    it('updates from flags', async () => {
      mockConnections.update.mockResolvedValue(mockApiConnection);
      await runConnectionUpdate('conn_01ABC', { name: 'Renamed' }, 'sk_test');
      expect(mockConnections.update).toHaveBeenCalledWith('conn_01ABC', { name: 'Renamed' });
      expect(consoleOutput.some((l) => l.includes('Updated connection'))).toBe(true);
    });

    it('updates from --data JSON body', async () => {
      mockConnections.update.mockResolvedValue(mockApiConnection);
      await runConnectionUpdate('conn_01ABC', { data: '{"external_id":null}' }, 'sk_test');
      expect(mockConnections.update).toHaveBeenCalledWith('conn_01ABC', { external_id: null });
    });

    it('rejects an empty update body', async () => {
      await expect(runConnectionUpdate('conn_01ABC', {}, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockConnections.update).not.toHaveBeenCalled();
    });
  });

  describe('runConnectionDelete', () => {
    it('deletes after confirmation', async () => {
      mockConfirm.mockResolvedValue(true);
      mockSdk.sso.deleteConnection.mockResolvedValue(undefined);
      await runConnectionDelete('conn_01ABC', {}, 'sk_test');
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockSdk.sso.deleteConnection).toHaveBeenCalledWith('conn_01ABC');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
    });

    it('skips confirmation with --force', async () => {
      mockSdk.sso.deleteConnection.mockResolvedValue(undefined);
      await runConnectionDelete('conn_01ABC', { force: true }, 'sk_test');
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockSdk.sso.deleteConnection).toHaveBeenCalledWith('conn_01ABC');
    });

    it('cancels on declined confirmation', async () => {
      mockConfirm.mockResolvedValue(false);
      await runConnectionDelete('conn_01ABC', {}, 'sk_test');
      expect(mockSdk.sso.deleteConnection).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('cancelled'))).toBe(true);
    });

    it('cancels on user cancel', async () => {
      mockConfirm.mockResolvedValue(Symbol('cancel'));
      mockIsCancel.mockReturnValue(true);
      await runConnectionDelete('conn_01ABC', {}, 'sk_test');
      expect(mockSdk.sso.deleteConnection).not.toHaveBeenCalled();
    });

    it('requires --force in agent mode', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      await expect(runConnectionDelete('conn_01ABC', {}, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockSdk.sso.deleteConnection).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    it('runConnectionList outputs JSON with data and listMetadata', async () => {
      mockSdk.sso.listConnections.mockResolvedValue({
        data: [mockConnection],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runConnectionList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('conn_01ABC');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runConnectionList outputs empty data for no results', async () => {
      mockSdk.sso.listConnections.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runConnectionList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
      expect(output.listMetadata).toBeDefined();
    });

    it('runConnectionGet outputs raw JSON', async () => {
      mockSdk.sso.getConnection.mockResolvedValue(mockConnection);
      await runConnectionGet('conn_01ABC', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('conn_01ABC');
      expect(output.name).toBe('Okta SSO');
    });

    it('runConnectionDelete outputs JSON success', async () => {
      mockSdk.sso.deleteConnection.mockResolvedValue(undefined);
      await runConnectionDelete('conn_01ABC', { force: true }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('conn_01ABC');
    });

    it('runConnectionCreate outputs the raw connection', async () => {
      mockConnections.create.mockResolvedValue(mockApiConnection);
      await runConnectionCreate({ org: 'org_123' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('conn_01ABC');
      expect(output.connection_type).toBe('GenericSAML');
    });

    it('runConnectionUpdate outputs the raw connection', async () => {
      mockConnections.update.mockResolvedValue(mockApiConnection);
      await runConnectionUpdate('conn_01ABC', { name: 'Renamed' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('conn_01ABC');
      expect(output.external_id).toBe('legacy-42');
    });
  });
});
