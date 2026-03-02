import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  sso: {
    listConnections: vi.fn(),
    getConnection: vi.fn(),
    deleteConnection: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

// Mock clack for confirmation prompts
const mockConfirm = vi.fn();
const mockIsCancel = vi.fn(() => false);

vi.mock('../utils/clack.js', () => ({
  default: {
    confirm: (...args: unknown[]) => mockConfirm(...args),
    isCancel: (...args: unknown[]) => mockIsCancel(...args),
  },
}));

// Mock environment detection
vi.mock('../utils/environment.js', () => ({
  isNonInteractiveEnvironment: vi.fn(() => false),
}));

const { setOutputMode } = await import('../utils/output.js');
const { isNonInteractiveEnvironment } = await import('../utils/environment.js');

const { runConnectionList, runConnectionGet, runConnectionDelete } = await import('./connection.js');

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

describe('connection commands', () => {
  let consoleOutput: string[];
  let stderrOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
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

    it('cancels on clack cancel', async () => {
      mockConfirm.mockResolvedValue(Symbol('cancel'));
      mockIsCancel.mockReturnValue(true);
      await runConnectionDelete('conn_01ABC', {}, 'sk_test');
      expect(mockSdk.sso.deleteConnection).not.toHaveBeenCalled();
    });

    it('requires --force in non-interactive mode', async () => {
      vi.mocked(isNonInteractiveEnvironment).mockReturnValue(true);
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      await expect(runConnectionDelete('conn_01ABC', {}, 'sk_test')).rejects.toThrow('process.exit(1)');
      expect(mockSdk.sso.deleteConnection).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
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
  });
});
