import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the unified client
const mockSdk = {
  directorySync: {
    listDirectories: vi.fn(),
    getDirectory: vi.fn(),
    deleteDirectory: vi.fn(),
    listUsers: vi.fn(),
    listGroups: vi.fn(),
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

const { setOutputMode } = await import('../utils/output.js');
const { resetInteractionModeForTests, setInteractionMode } = await import('../utils/interaction-mode.js');

const { runDirectoryList, runDirectoryGet, runDirectoryDelete, runDirectoryListUsers, runDirectoryListGroups } =
  await import('./directory.js');

const mockDirectory = {
  id: 'directory_01ABC',
  name: 'Okta SCIM',
  type: 'okta scim v2.0',
  organizationId: 'org_123',
  state: 'active',
  domain: 'example.com',
  externalKey: 'ext_key',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockDirectoryUser = {
  id: 'directory_user_01ABC',
  email: 'user@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  state: 'active',
  directoryId: 'directory_01ABC',
  organizationId: 'org_123',
  idpId: 'idp_123',
  customAttributes: {},
  rawAttributes: {},
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

const mockDirectoryGroup = {
  id: 'directory_group_01ABC',
  name: 'Engineering',
  directoryId: 'directory_01ABC',
  organizationId: 'org_123',
  idpId: 'idp_123',
  rawAttributes: {},
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('directory commands', () => {
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

  describe('runDirectoryList', () => {
    it('lists directories in table format', async () => {
      mockSdk.directorySync.listDirectories.mockResolvedValue({
        data: [mockDirectory],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryList({}, 'sk_test');
      expect(mockSdk.directorySync.listDirectories).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('Okta SCIM'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('directory_01ABC'))).toBe(true);
    });

    it('passes organization filter', async () => {
      mockSdk.directorySync.listDirectories.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryList({ organizationId: 'org_123' }, 'sk_test');
      expect(mockSdk.directorySync.listDirectories).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_123' }),
      );
    });

    it('handles empty results', async () => {
      mockSdk.directorySync.listDirectories.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No directories found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.directorySync.listDirectories.mockResolvedValue({
        data: [mockDirectory],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runDirectoryList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runDirectoryGet', () => {
    it('fetches and prints directory', async () => {
      mockSdk.directorySync.getDirectory.mockResolvedValue(mockDirectory);
      await runDirectoryGet('directory_01ABC', 'sk_test');
      expect(mockSdk.directorySync.getDirectory).toHaveBeenCalledWith('directory_01ABC');
      expect(consoleOutput.some((l) => l.includes('directory_01ABC'))).toBe(true);
    });
  });

  describe('runDirectoryDelete', () => {
    it('deletes after confirmation', async () => {
      mockConfirm.mockResolvedValue(true);
      mockSdk.directorySync.deleteDirectory.mockResolvedValue(undefined);
      await runDirectoryDelete('directory_01ABC', {}, 'sk_test');
      expect(mockConfirm).toHaveBeenCalled();
      expect(mockSdk.directorySync.deleteDirectory).toHaveBeenCalledWith('directory_01ABC');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
    });

    it('skips confirmation with --force', async () => {
      mockSdk.directorySync.deleteDirectory.mockResolvedValue(undefined);
      await runDirectoryDelete('directory_01ABC', { force: true }, 'sk_test');
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockSdk.directorySync.deleteDirectory).toHaveBeenCalledWith('directory_01ABC');
    });

    it('cancels on declined confirmation', async () => {
      mockConfirm.mockResolvedValue(false);
      await runDirectoryDelete('directory_01ABC', {}, 'sk_test');
      expect(mockSdk.directorySync.deleteDirectory).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('cancelled'))).toBe(true);
    });

    it('cancels on clack cancel', async () => {
      mockConfirm.mockResolvedValue(Symbol('cancel'));
      mockIsCancel.mockReturnValue(true);
      await runDirectoryDelete('directory_01ABC', {}, 'sk_test');
      expect(mockSdk.directorySync.deleteDirectory).not.toHaveBeenCalled();
    });

    it('requires --force in agent mode', async () => {
      setInteractionMode({ mode: 'agent', source: 'env' });
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      await expect(runDirectoryDelete('directory_01ABC', {}, 'sk_test')).rejects.toThrow('process.exit(1)');
      expect(mockSdk.directorySync.deleteDirectory).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('runDirectoryListUsers', () => {
    it('lists users in table format', async () => {
      mockSdk.directorySync.listUsers.mockResolvedValue({
        data: [mockDirectoryUser],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListUsers({ directory: 'directory_01ABC' }, 'sk_test');
      expect(mockSdk.directorySync.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ directory: 'directory_01ABC' }),
      );
      expect(consoleOutput.some((l) => l.includes('user@example.com'))).toBe(true);
    });

    it('passes group filter', async () => {
      mockSdk.directorySync.listUsers.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListUsers({ group: 'directory_group_01ABC' }, 'sk_test');
      expect(mockSdk.directorySync.listUsers).toHaveBeenCalledWith(
        expect.objectContaining({ group: 'directory_group_01ABC' }),
      );
    });

    it('requires --directory or --group', async () => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`process.exit(${code})`);
      });
      await expect(runDirectoryListUsers({}, 'sk_test')).rejects.toThrow('process.exit(1)');
      expect(mockSdk.directorySync.listUsers).not.toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('handles empty results', async () => {
      mockSdk.directorySync.listUsers.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListUsers({ directory: 'directory_01ABC' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No directory users found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.directorySync.listUsers.mockResolvedValue({
        data: [mockDirectoryUser],
        listMetadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runDirectoryListUsers({ directory: 'directory_01ABC' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
    });
  });

  describe('runDirectoryListGroups', () => {
    it('lists groups in table format', async () => {
      mockSdk.directorySync.listGroups.mockResolvedValue({
        data: [mockDirectoryGroup],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListGroups({ directory: 'directory_01ABC' }, 'sk_test');
      expect(mockSdk.directorySync.listGroups).toHaveBeenCalledWith(
        expect.objectContaining({ directory: 'directory_01ABC' }),
      );
      expect(consoleOutput.some((l) => l.includes('Engineering'))).toBe(true);
    });

    it('handles empty results', async () => {
      mockSdk.directorySync.listGroups.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListGroups({ directory: 'directory_01ABC' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No directory groups found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockSdk.directorySync.listGroups.mockResolvedValue({
        data: [mockDirectoryGroup],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runDirectoryListGroups({ directory: 'directory_01ABC' }, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    it('runDirectoryList outputs JSON with data and listMetadata', async () => {
      mockSdk.directorySync.listDirectories.mockResolvedValue({
        data: [mockDirectory],
        listMetadata: { before: null, after: 'cursor_a' },
      });
      await runDirectoryList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].id).toBe('directory_01ABC');
      expect(output.listMetadata.after).toBe('cursor_a');
    });

    it('runDirectoryList outputs empty data for no results', async () => {
      mockSdk.directorySync.listDirectories.mockResolvedValue({
        data: [],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryList({}, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
    });

    it('runDirectoryGet outputs raw JSON', async () => {
      mockSdk.directorySync.getDirectory.mockResolvedValue(mockDirectory);
      await runDirectoryGet('directory_01ABC', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('directory_01ABC');
      expect(output.name).toBe('Okta SCIM');
    });

    it('runDirectoryDelete outputs JSON success', async () => {
      mockSdk.directorySync.deleteDirectory.mockResolvedValue(undefined);
      await runDirectoryDelete('directory_01ABC', { force: true }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('directory_01ABC');
    });

    it('runDirectoryListUsers outputs JSON', async () => {
      mockSdk.directorySync.listUsers.mockResolvedValue({
        data: [mockDirectoryUser],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListUsers({ directory: 'directory_01ABC' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].email).toBe('user@example.com');
    });

    it('runDirectoryListGroups outputs JSON', async () => {
      mockSdk.directorySync.listGroups.mockResolvedValue({
        data: [mockDirectoryGroup],
        listMetadata: { before: null, after: null },
      });
      await runDirectoryListGroups({ directory: 'directory_01ABC' }, 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].name).toBe('Engineering');
    });
  });
});
