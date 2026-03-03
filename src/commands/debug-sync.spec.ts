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

  const linkedDirectory = {
    id: 'dir_123',
    name: 'Okta SCIM',
    type: 'okta scim v2.0',
    state: 'linked',
    organizationId: 'org_123',
    createdAt: '2024-01-01',
  };

  const unlinkedDirectory = {
    ...linkedDirectory,
    name: 'Broken Dir',
    state: 'unlinked',
    organizationId: null,
  };

  function mockCountsAndEvents(opts?: {
    users?: number;
    hasMore?: boolean;
    groups?: number;
    events?: Array<{ id: string; event: string; createdAt: string }>;
  }) {
    const users = Array.from({ length: opts?.users ?? 0 }, (_, i) => ({ id: `u${i}` }));
    const groups = Array.from({ length: opts?.groups ?? 0 }, (_, i) => ({ id: `g${i}` }));
    mockSdk.directorySync.listUsers.mockResolvedValue({
      data: users,
      listMetadata: { after: opts?.hasMore ? 'cursor' : null },
    });
    mockSdk.directorySync.listGroups.mockResolvedValue({ data: groups, listMetadata: { after: null } });
    mockSdk.events.listEvents.mockResolvedValue({ data: opts?.events ?? [], listMetadata: {} });
  }

  it('displays directory details', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents({
      users: 1,
      groups: 1,
      events: [{ id: 'evt_1', event: 'dsync.user.created', createdAt: '2024-01-02' }],
    });

    await runDebugSync('dir_123', 'sk_test');

    expect(mockSdk.directorySync.getDirectory).toHaveBeenCalledWith('dir_123');
    expect(consoleOutput.some((l) => l.includes('Okta SCIM'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('okta scim v2.0'))).toBe(true);
  });

  it('shows user and group counts', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents({
      users: 1,
      groups: 1,
      events: [{ id: 'e', event: 'dsync.user.created', createdAt: '2024-01-01' }],
    });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Users: 1'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('Groups: 1'))).toBe(true);
  });

  it('shows 1+ when pagination indicates more results', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents({
      users: 1,
      hasMore: true,
      events: [{ id: 'e', event: 'dsync.user.created', createdAt: '2024-01-01' }],
    });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Users: 1+'))).toBe(true);
  });

  it('reports no issues for linked directory with events', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents({ events: [{ id: 'e', event: 'dsync.user.created', createdAt: '2024-01-01' }] });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('No issues detected'))).toBe(true);
  });

  it('identifies unlinked directory as an issue', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(unlinkedDirectory);
    mockCountsAndEvents();

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('not linked'))).toBe(true);
  });

  it('warns when no sync events found (stalled)', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents({ events: [] });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('stalled'))).toBe(true);
  });

  it('shows recent sync events', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents({
      events: [
        { id: 'evt_1', event: 'dsync.user.created', createdAt: '2024-01-02' },
        { id: 'evt_2', event: 'dsync.group.created', createdAt: '2024-01-03' },
      ],
    });

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('dsync.user.created'))).toBe(true);
    expect(consoleOutput.some((l) => l.includes('dsync.group.created'))).toBe(true);
  });

  it('handles user listing failure gracefully', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockSdk.directorySync.listUsers.mockRejectedValue(new Error('Access denied'));
    mockSdk.directorySync.listGroups.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.events.listEvents.mockResolvedValue({ data: [], listMetadata: {} });

    await runDebugSync('dir_123', 'sk_test');

    // Should still complete
    expect(consoleOutput.some((l) => l.includes('Okta SCIM'))).toBe(true);
  });

  it('handles event listing failure gracefully', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockSdk.directorySync.listUsers.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.directorySync.listGroups.mockResolvedValue({ data: [], listMetadata: { after: null } });
    mockSdk.events.listEvents.mockRejectedValue(new Error('Events not available'));

    await runDebugSync('dir_123', 'sk_test');

    expect(consoleOutput.some((l) => l.includes('Okta SCIM'))).toBe(true);
  });

  it('filters events by organizationId when directory has one', async () => {
    mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
    mockCountsAndEvents();

    await runDebugSync('dir_123', 'sk_test');

    expect(mockSdk.events.listEvents).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org_123' }));
  });

  describe('JSON mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('outputs directory details as JSON', async () => {
      mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
      mockCountsAndEvents({
        users: 1,
        groups: 1,
        events: [{ id: 'e', event: 'dsync.user.created', createdAt: '2024-01-01' }],
      });

      await runDebugSync('dir_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.directory.id).toBe('dir_123');
      expect(output.directory.name).toBe('Okta SCIM');
      expect(output.userCount).toBe(1);
      expect(output.groupCount).toBe(1);
      expect(output.recentEvents).toHaveLength(1);
      expect(output.issues).toEqual([]);
    });

    it('includes issues in JSON for unlinked directory', async () => {
      mockSdk.directorySync.getDirectory.mockResolvedValue(unlinkedDirectory);
      mockCountsAndEvents();

      await runDebugSync('dir_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.issues).toEqual(expect.arrayContaining([expect.stringContaining('not linked')]));
    });

    it('reports 1+ user count as string in JSON', async () => {
      mockSdk.directorySync.getDirectory.mockResolvedValue(linkedDirectory);
      mockCountsAndEvents({
        users: 1,
        hasMore: true,
        events: [{ id: 'e', event: 'dsync.user.created', createdAt: '2024-01-01' }],
      });

      await runDebugSync('dir_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.userCount).toBe('1+');
    });
  });
});
