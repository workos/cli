import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  directorySync: {
    getDirectory: vi.fn(),
    listUsers: vi.fn(),
    listGroups: vi.fn(),
  },
  events: { listEvents: vi.fn() },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk }),
}));

const { setOutputMode } = await import('../utils/output.js');
const { runDebugSync } = await import('./debug-sync.js');

describe('debug-sync command', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('displays directory details with user/group counts', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue({
      id: 'dir_123',
      name: 'Okta SCIM',
      type: 'okta scim v2.0',
      state: 'linked',
      organizationId: 'org_123',
      createdAt: '2024-01-01',
    });
    mockSdk.directorySync.listUsers.mockResolvedValue({ data: [{ id: 'u1' }], listMetadata: { after: null } });
    mockSdk.directorySync.listGroups.mockResolvedValue({ data: [{ id: 'g1' }], listMetadata: { after: null } });
    mockSdk.events.listEvents.mockResolvedValue({
      data: [{ id: 'evt_1', event: 'dsync.user.created', createdAt: '2024-01-02' }],
      listMetadata: {},
    });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Okta SCIM'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('linked'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('dsync.user.created'))).toBe(true);
  });

  it('identifies unlinked directory', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue({
      id: 'dir_123',
      name: 'Broken Dir',
      type: 'okta scim v2.0',
      state: 'unlinked',
      organizationId: null,
      createdAt: '2024-01-01',
    });
    mockSdk.directorySync.listUsers.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.directorySync.listGroups.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('not linked'))).toBe(true);
  });

  it('warns when no sync events found', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue({
      id: 'dir_123',
      name: 'Dir',
      type: 'okta scim v2.0',
      state: 'linked',
      organizationId: null,
      createdAt: '2024-01-01',
    });
    mockSdk.directorySync.listUsers.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.directorySync.listGroups.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('stalled'))).toBe(true);
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs full diagnosis as JSON', async () => {
      mockSdk.directorySync.getDirectory.mockResolvedValue({
        id: 'dir_123',
        name: 'Dir',
        type: 'okta scim v2.0',
        state: 'unlinked',
        organizationId: null,
        createdAt: '2024-01-01',
      });
      mockSdk.directorySync.listUsers.mockResolvedValue({ data: [], listMetadata: { after: null } });
      mockSdk.directorySync.listGroups.mockResolvedValue({ data: [], listMetadata: { after: null } });
      mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

      await runDebugSync('dir_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.directory.id).toBe('dir_123');
      expect(output.issues.length).toBeGreaterThan(0);
    });
  });
});
