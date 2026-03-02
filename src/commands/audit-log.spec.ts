import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockSdk = {
  auditLogs: {
    createEvent: vi.fn(),
    createExport: vi.fn(),
    getExport: vi.fn(),
    createSchema: vi.fn(),
  },
};

const mockAuditLogs = {
  listActions: vi.fn(),
  getSchema: vi.fn(),
  getRetention: vi.fn(),
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => ({ sdk: mockSdk, auditLogs: mockAuditLogs }),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

const { readFile } = await import('node:fs/promises');
const mockReadFile = vi.mocked(readFile);

const { setOutputMode } = await import('../utils/output.js');
const {
  runAuditLogCreateEvent,
  runAuditLogExport,
  runAuditLogListActions,
  runAuditLogGetSchema,
  runAuditLogCreateSchema,
  runAuditLogGetRetention,
} = await import('./audit-log.js');

describe('audit-log commands', () => {
  let consoleOutput: string[];
  let stderrOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    stderrOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrOutput.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── create-event ──────────────────────────────────────────────────

  describe('runAuditLogCreateEvent', () => {
    it('creates event from flags', async () => {
      mockSdk.auditLogs.createEvent.mockResolvedValue(undefined);

      await runAuditLogCreateEvent(
        'org_123',
        { action: 'user.signed_in', actorType: 'user', actorId: 'user_01' },
        'sk_test',
      );

      expect(mockSdk.auditLogs.createEvent).toHaveBeenCalledWith(
        'org_123',
        expect.objectContaining({
          action: 'user.signed_in',
          actor: expect.objectContaining({ id: 'user_01', type: 'user' }),
        }),
      );
      expect(consoleOutput.some((l) => l.includes('Created audit log event'))).toBe(true);
    });

    it('creates event from file', async () => {
      const eventJson = {
        action: 'user.signed_in',
        occurredAt: '2025-01-15T10:00:00Z',
        actor: { id: 'user_01', type: 'user' },
        targets: [],
        context: { location: '127.0.0.1' },
      };
      mockReadFile.mockResolvedValue(JSON.stringify(eventJson));
      mockSdk.auditLogs.createEvent.mockResolvedValue(undefined);

      await runAuditLogCreateEvent('org_123', { file: 'event.json' }, 'sk_test');

      expect(mockReadFile).toHaveBeenCalledWith('event.json', 'utf-8');
      expect(mockSdk.auditLogs.createEvent).toHaveBeenCalledWith('org_123', eventJson);
    });

    it('errors when required flags missing', async () => {
      await expect(runAuditLogCreateEvent('org_123', { action: 'test' }, 'sk_test')).rejects.toThrow();
    });
  });

  // ── export ────────────────────────────────────────────────────────

  describe('runAuditLogExport', () => {
    it('creates and polls export until ready', async () => {
      mockSdk.auditLogs.createExport.mockResolvedValue({
        id: 'export_01',
        state: 'pending',
        url: null,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });
      mockSdk.auditLogs.getExport
        .mockResolvedValueOnce({
          id: 'export_01',
          state: 'pending',
          url: null,
          createdAt: '2025-01-15T10:00:00Z',
          updatedAt: '2025-01-15T10:00:01Z',
        })
        .mockResolvedValueOnce({
          id: 'export_01',
          state: 'ready',
          url: 'https://exports.workos.com/export_01.csv',
          createdAt: '2025-01-15T10:00:00Z',
          updatedAt: '2025-01-15T10:00:02Z',
        });

      await runAuditLogExport(
        {
          organizationId: 'org_123',
          rangeStart: '2025-01-01T00:00:00Z',
          rangeEnd: '2025-02-01T00:00:00Z',
        },
        'sk_test',
      );

      expect(mockSdk.auditLogs.createExport).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org_123' }),
      );
      expect(mockSdk.auditLogs.getExport).toHaveBeenCalledTimes(2);
      expect(consoleOutput.some((l) => l.includes('Export ready'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('https://exports.workos.com/export_01.csv'))).toBe(true);
    });

    it('returns immediately when export is already ready', async () => {
      mockSdk.auditLogs.createExport.mockResolvedValue({
        id: 'export_01',
        state: 'ready',
        url: 'https://exports.workos.com/export_01.csv',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });

      await runAuditLogExport(
        {
          organizationId: 'org_123',
          rangeStart: '2025-01-01T00:00:00Z',
          rangeEnd: '2025-02-01T00:00:00Z',
        },
        'sk_test',
      );

      expect(mockSdk.auditLogs.getExport).not.toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('Export ready'))).toBe(true);
    });

    it('handles export error state', async () => {
      mockSdk.auditLogs.createExport.mockResolvedValue({
        id: 'export_01',
        state: 'error',
        url: null,
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });

      await expect(
        runAuditLogExport(
          {
            organizationId: 'org_123',
            rangeStart: '2025-01-01T00:00:00Z',
            rangeEnd: '2025-02-01T00:00:00Z',
          },
          'sk_test',
        ),
      ).rejects.toThrow();
    });

    it('passes optional filters', async () => {
      mockSdk.auditLogs.createExport.mockResolvedValue({
        id: 'export_01',
        state: 'ready',
        url: 'https://exports.workos.com/export_01.csv',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });

      await runAuditLogExport(
        {
          organizationId: 'org_123',
          rangeStart: '2025-01-01T00:00:00Z',
          rangeEnd: '2025-02-01T00:00:00Z',
          actions: ['user.signed_in'],
          actorNames: ['Alice'],
        },
        'sk_test',
      );

      expect(mockSdk.auditLogs.createExport).toHaveBeenCalledWith(
        expect.objectContaining({
          actions: ['user.signed_in'],
          actorNames: ['Alice'],
        }),
      );
    });
  });

  // ── list-actions ──────────────────────────────────────────────────

  describe('runAuditLogListActions', () => {
    it('lists actions in table format', async () => {
      mockAuditLogs.listActions.mockResolvedValue({
        data: [{ action: 'user.signed_in' }, { action: 'user.signed_out' }],
        list_metadata: { before: null, after: null },
      });

      await runAuditLogListActions('sk_test');

      expect(mockAuditLogs.listActions).toHaveBeenCalled();
      expect(consoleOutput.some((l) => l.includes('user.signed_in'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('user.signed_out'))).toBe(true);
    });

    it('handles empty results', async () => {
      mockAuditLogs.listActions.mockResolvedValue({
        data: [],
        list_metadata: { before: null, after: null },
      });

      await runAuditLogListActions('sk_test');
      expect(consoleOutput.some((l) => l.includes('No audit log actions found'))).toBe(true);
    });
  });

  // ── get-schema ────────────────────────────────────────────────────

  describe('runAuditLogGetSchema', () => {
    it('prints schema for action', async () => {
      const schema = {
        version: 1,
        targets: [{ type: 'user' }],
        metadata: { ip: { type: 'string' } },
      };
      mockAuditLogs.getSchema.mockResolvedValue(schema);

      await runAuditLogGetSchema('user.signed_in', 'sk_test');

      expect(mockAuditLogs.getSchema).toHaveBeenCalledWith('user.signed_in');
      expect(consoleOutput.some((l) => l.includes('user.signed_in'))).toBe(true);
    });
  });

  // ── create-schema ─────────────────────────────────────────────────

  describe('runAuditLogCreateSchema', () => {
    it('creates schema from file', async () => {
      const schemaJson = { targets: [{ type: 'user' }], metadata: { ip: { type: 'string' } } };
      mockReadFile.mockResolvedValue(JSON.stringify(schemaJson));
      mockSdk.auditLogs.createSchema.mockResolvedValue({
        object: 'audit_log_schema',
        version: 1,
        ...schemaJson,
        createdAt: '2025-01-15T10:00:00Z',
      });

      await runAuditLogCreateSchema('user.signed_in', 'schema.json', 'sk_test');

      expect(mockReadFile).toHaveBeenCalledWith('schema.json', 'utf-8');
      expect(mockSdk.auditLogs.createSchema).toHaveBeenCalledWith({
        action: 'user.signed_in',
        ...schemaJson,
      });
      expect(consoleOutput.some((l) => l.includes('Created audit log schema'))).toBe(true);
    });
  });

  // ── get-retention ─────────────────────────────────────────────────

  describe('runAuditLogGetRetention', () => {
    it('prints retention period', async () => {
      mockAuditLogs.getRetention.mockResolvedValue({ retention_period_in_days: 90 });

      await runAuditLogGetRetention('org_123', 'sk_test');

      expect(mockAuditLogs.getRetention).toHaveBeenCalledWith('org_123');
      expect(consoleOutput.some((l) => l.includes('90'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('days'))).toBe(true);
    });
  });

  // ── JSON output mode ──────────────────────────────────────────────

  describe('JSON output mode', () => {
    beforeEach(() => {
      setOutputMode('json');
    });

    afterEach(() => {
      setOutputMode('human');
    });

    it('runAuditLogCreateEvent outputs JSON success', async () => {
      mockSdk.auditLogs.createEvent.mockResolvedValue(undefined);

      await runAuditLogCreateEvent(
        'org_123',
        { action: 'user.signed_in', actorType: 'user', actorId: 'user_01' },
        'sk_test',
      );

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.organization_id).toBe('org_123');
    });

    it('runAuditLogExport outputs JSON', async () => {
      mockSdk.auditLogs.createExport.mockResolvedValue({
        id: 'export_01',
        state: 'ready',
        url: 'https://exports.workos.com/export_01.csv',
        createdAt: '2025-01-15T10:00:00Z',
        updatedAt: '2025-01-15T10:00:00Z',
      });

      await runAuditLogExport(
        {
          organizationId: 'org_123',
          rangeStart: '2025-01-01T00:00:00Z',
          rangeEnd: '2025-02-01T00:00:00Z',
        },
        'sk_test',
      );

      const output = JSON.parse(consoleOutput[0]);
      expect(output.id).toBe('export_01');
      expect(output.state).toBe('ready');
      expect(output.url).toBe('https://exports.workos.com/export_01.csv');
    });

    it('runAuditLogListActions outputs JSON', async () => {
      const response = {
        data: [{ action: 'user.signed_in' }],
        list_metadata: { before: null, after: null },
      };
      mockAuditLogs.listActions.mockResolvedValue(response);

      await runAuditLogListActions('sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toHaveLength(1);
      expect(output.data[0].action).toBe('user.signed_in');
    });

    it('runAuditLogGetSchema outputs JSON', async () => {
      const schema = { version: 1, targets: [{ type: 'user' }] };
      mockAuditLogs.getSchema.mockResolvedValue(schema);

      await runAuditLogGetSchema('user.signed_in', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.version).toBe(1);
    });

    it('runAuditLogCreateSchema outputs JSON success', async () => {
      const schemaJson = { targets: [{ type: 'user' }] };
      mockReadFile.mockResolvedValue(JSON.stringify(schemaJson));
      mockSdk.auditLogs.createSchema.mockResolvedValue({
        object: 'audit_log_schema',
        version: 1,
        ...schemaJson,
        createdAt: '2025-01-15T10:00:00Z',
      });

      await runAuditLogCreateSchema('user.signed_in', 'schema.json', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.message).toBe('Created audit log schema');
    });

    it('runAuditLogGetRetention outputs JSON', async () => {
      mockAuditLogs.getRetention.mockResolvedValue({ retention_period_in_days: 90 });

      await runAuditLogGetRetention('org_123', 'sk_test');

      const output = JSON.parse(consoleOutput[0]);
      expect(output.retention_period_in_days).toBe(90);
    });
  });
});
