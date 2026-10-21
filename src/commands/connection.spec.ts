import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  sso: {
    listConnections: vi.fn(),
    getConnection: vi.fn(),
    deleteConnection: vi.fn(),
    getAuthorizationUrl: vi.fn(),
    getProfileAndToken: vi.fn(),
  },
};

const mockRedirectUriAdd = vi.fn();
const mockConnections = {
  create: vi.fn(),
  update: vi.fn(),
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk, redirectUris: { add: mockRedirectUriAdd }, connections: mockConnections }),
}));

const mockGetActiveEnvironment = vi.fn();

vi.mock('../lib/config-store.js', () => ({
  getActiveEnvironment: (...args: unknown[]) => mockGetActiveEnvironment(...args),
}));

const mockOpen = vi.fn();

vi.mock('open', () => ({
  default: (...args: unknown[]) => mockOpen(...args),
}));

type RequestHandler = (req: { url?: string }, res: unknown) => void;

let requestHandler: RequestHandler | undefined;

const mockServer = {
  once: vi.fn(),
  on: vi.fn((event: string, handler: RequestHandler) => {
    if (event === 'request') requestHandler = handler;
  }),
  listen: vi.fn((_port: number, _host: string, cb: () => void) => cb()),
  close: vi.fn(),
};

vi.mock('node:http', () => ({
  default: { createServer: () => mockServer },
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

const {
  runConnectionList,
  runConnectionGet,
  runConnectionDelete,
  runConnectionCreate,
  runConnectionUpdate,
  runConnectionTest,
} = await import('./connection.js');
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
  organizationId: 'org_123',
  name: 'Okta SSO',
  type: 'GenericSAML',
  state: 'active',
  externalId: 'legacy-42',
  domains: [{ object: 'connection_domain', id: 'org_domain_123', domain: 'example.com' }],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
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
    requestHandler = undefined;
    mockServer.on.mockImplementation((event: string, handler: RequestHandler) => {
      if (event === 'request') requestHandler = handler;
    });
    mockServer.listen.mockImplementation((_port: number, _host: string, cb: () => void) => cb());
    mockGetActiveEnvironment.mockReturnValue({ clientId: 'client_env' });
    mockOpen.mockResolvedValue(undefined);
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
      expect(consoleOutput.some((l) => l.includes('canceled'))).toBe(true);
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

  describe('runConnectionTest', () => {
    function makeRes() {
      const res = {
        writeHead: vi.fn(() => res),
        end: vi.fn(),
      };
      return res;
    }

    async function dispatchCallback(query: (state: string) => string): Promise<void> {
      await vi.waitFor(() => {
        if (!requestHandler) throw new Error('request handler not registered');
      });
      const state = mockSdk.sso.getAuthorizationUrl.mock.calls[0][0].state;
      requestHandler?.({ url: `/callback?${query(state)}` }, makeRes());
    }

    beforeEach(() => {
      mockSdk.sso.getConnection.mockResolvedValue(mockConnection);
      mockRedirectUriAdd.mockResolvedValue({ success: true, alreadyExists: false });
      mockSdk.sso.getAuthorizationUrl.mockReturnValue('https://api.workos.com/sso/authorize?mock=1');
      mockSdk.sso.getProfileAndToken.mockResolvedValue({
        profile: {
          id: 'prof_01',
          email: 'user@example.com',
          firstName: 'Test',
          lastName: 'User',
          connectionId: 'conn_01ABC',
          connectionType: 'OktaSAML',
          organizationId: 'org_123',
          idpId: 'idp_1',
        },
      });
    });

    it('registers redirect URI, opens browser, and exchanges the code', async () => {
      const run = runConnectionTest('conn_01ABC', {}, 'sk_test');
      await dispatchCallback((state) => `code=auth_code_123&state=${state}`);
      await run;

      expect(mockRedirectUriAdd).toHaveBeenCalledWith('http://localhost:4807/callback');
      expect(mockSdk.sso.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client_env',
          redirectUri: 'http://localhost:4807/callback',
          connection: 'conn_01ABC',
        }),
      );
      expect(mockOpen).toHaveBeenCalledWith('https://api.workos.com/sso/authorize?mock=1');
      expect(mockSdk.sso.getProfileAndToken).toHaveBeenCalledWith({ code: 'auth_code_123', clientId: 'client_env' });
      expect(consoleOutput.some((l) => l.includes('user@example.com'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('SSO test succeeded'))).toBe(true);
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('uses --client-id and --port over defaults', async () => {
      const run = runConnectionTest('conn_01ABC', { clientId: 'client_flag', port: 9999 }, 'sk_test');
      await dispatchCallback((state) => `code=abc&state=${state}`);
      await run;

      expect(mockRedirectUriAdd).toHaveBeenCalledWith('http://localhost:9999/callback');
      expect(mockSdk.sso.getAuthorizationUrl).toHaveBeenCalledWith(
        expect.objectContaining({ clientId: 'client_flag', redirectUri: 'http://localhost:9999/callback' }),
      );
    });

    it('does not open the browser with open: false', async () => {
      const run = runConnectionTest('conn_01ABC', { open: false }, 'sk_test');
      await dispatchCallback((state) => `code=abc&state=${state}`);
      await run;
      expect(mockOpen).not.toHaveBeenCalled();
    });

    it('fails when no client ID is available', async () => {
      mockGetActiveEnvironment.mockReturnValue(null);
      await expect(runConnectionTest('conn_01ABC', {}, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockSdk.sso.getAuthorizationUrl).not.toHaveBeenCalled();
    });

    it('fails on IdP error callback', async () => {
      const run = runConnectionTest('conn_01ABC', {}, 'sk_test');
      await dispatchCallback((state) => `error=access_denied&error_description=denied&state=${state}`);
      await expect(run).rejects.toThrow(CliExit);
      expect(mockSdk.sso.getProfileAndToken).not.toHaveBeenCalled();
    });

    it('ignores callbacks with mismatched state and accepts the real one', async () => {
      const run = runConnectionTest('conn_01ABC', {}, 'sk_test');
      await dispatchCallback(() => 'code=abc&state=wrong_state');
      expect(mockSdk.sso.getProfileAndToken).not.toHaveBeenCalled();
      await dispatchCallback((state) => `code=real_code&state=${state}`);
      await run;
      expect(mockSdk.sso.getProfileAndToken).toHaveBeenCalledWith({ code: 'real_code', clientId: 'client_env' });
    });

    it('errors in agent mode when redirect URI registration fails', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      mockRedirectUriAdd.mockRejectedValue(new Error('forbidden'));
      await expect(runConnectionTest('conn_01ABC', {}, 'sk_test')).rejects.toThrow(CliExit);
      expect(mockSdk.sso.getAuthorizationUrl).not.toHaveBeenCalled();
    });

    it('prompts to add redirect URI manually when registration fails', async () => {
      mockRedirectUriAdd.mockRejectedValue(new Error('forbidden'));
      mockConfirm.mockResolvedValue(true);
      const run = runConnectionTest('conn_01ABC', {}, 'sk_test');
      await dispatchCallback((state) => `code=abc&state=${state}`);
      await run;
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockSdk.sso.getProfileAndToken).toHaveBeenCalled();
    });

    it('cancels when manual redirect URI prompt is declined', async () => {
      mockRedirectUriAdd.mockRejectedValue(new Error('forbidden'));
      mockConfirm.mockResolvedValue(false);
      await runConnectionTest('conn_01ABC', {}, 'sk_test');
      expect(mockSdk.sso.getAuthorizationUrl).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('cancelled'))).toBe(true);
    });

    it('outputs JSON with profile in JSON mode', async () => {
      setOutputMode('json');
      const run = runConnectionTest('conn_01ABC', {}, 'sk_test');
      await dispatchCallback((state) => `code=abc&state=${state}`);
      await run;
      const output = JSON.parse(consoleOutput[0]);
      expect(output.connectionId).toBe('conn_01ABC');
      expect(output.redirectUri).toBe('http://localhost:4807/callback');
      expect(output.redirectUriRegistered).toBe(true);
      expect(output.profile.email).toBe('user@example.com');
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

    it('runConnectionCreate outputs the success envelope with the connection', async () => {
      mockConnections.create.mockResolvedValue(mockApiConnection);
      await runConnectionCreate({ org: 'org_123' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('conn_01ABC');
      expect(output.data.organizationId).toBe('org_123');
      expect(output.data.type).toBe('GenericSAML');
      expect(output.data.domains[0].domain).toBe('example.com');
      expect(output.data.connection_type).toBeUndefined();
    });

    it('runConnectionUpdate outputs the success envelope with the connection', async () => {
      mockConnections.update.mockResolvedValue(mockApiConnection);
      await runConnectionUpdate('conn_01ABC', { name: 'Renamed' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('conn_01ABC');
      expect(output.data.externalId).toBe('legacy-42');
      expect(output.data.external_id).toBeUndefined();
    });
  });
});
