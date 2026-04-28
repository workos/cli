import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockClient = {
  sdk: {},
  webhooks: {
    list: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock('../lib/workos-client.js', () => ({
  createWorkOSClient: () => mockClient,
}));

const { setOutputMode } = await import('../utils/output.js');

const { runWebhookList, runWebhookCreate, runWebhookDelete } = await import('./webhook.js');

const mockWebhook = {
  id: 'we_123',
  endpoint_url: 'https://example.com/hook',
  events: ['dsync.user.created'],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

describe('webhook commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runWebhookList', () => {
    it('lists endpoints in table', async () => {
      mockClient.webhooks.list.mockResolvedValue({
        data: [mockWebhook],
        list_metadata: { before: null, after: null },
      });
      await runWebhookList('sk_test');
      expect(consoleOutput.some((l) => l.includes('we_123'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('https://example.com/hook'))).toBe(true);
    });

    it('handles empty results', async () => {
      mockClient.webhooks.list.mockResolvedValue({
        data: [],
        list_metadata: { before: null, after: null },
      });
      await runWebhookList('sk_test');
      expect(consoleOutput.some((l) => l.includes('No webhook endpoints found'))).toBe(true);
    });

    it('truncates long event lists with a "+N more" suffix', async () => {
      mockClient.webhooks.list.mockResolvedValue({
        data: [
          {
            ...mockWebhook,
            events: [
              'user.created',
              'user.updated',
              'user.deleted',
              'session.created',
              'session.revoked',
              'organization.created',
              'organization.updated',
            ],
          },
        ],
        list_metadata: { before: null, after: null },
      });
      await runWebhookList('sk_test');
      expect(consoleOutput.some((l) => /\+\d+ more/.test(l))).toBe(true);
    });

    it('always shows at least one event when a single event name exceeds the budget', async () => {
      const longEvent = 'a.very.long.namespace.with.many.segments.that.exceeds.sixty.chars.event';
      mockClient.webhooks.list.mockResolvedValue({
        data: [{ ...mockWebhook, events: [longEvent, 'user.created'] }],
        list_metadata: { before: null, after: null },
      });
      await runWebhookList('sk_test');
      expect(consoleOutput.some((l) => l.includes(longEvent))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('(+1 more)'))).toBe(true);
    });
  });

  describe('runWebhookCreate', () => {
    it('creates webhook with url and events', async () => {
      mockClient.webhooks.create.mockResolvedValue(mockWebhook);
      await runWebhookCreate('https://example.com/hook', ['dsync.user.created'], 'sk_test');
      expect(mockClient.webhooks.create).toHaveBeenCalledWith('https://example.com/hook', ['dsync.user.created']);
    });

    it('displays secret warning in human mode', async () => {
      mockClient.webhooks.create.mockResolvedValue({ ...mockWebhook, secret: 'whsec_abc123' });
      await runWebhookCreate('https://example.com/hook', ['dsync.user.created'], 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created webhook endpoint'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('whsec_abc123'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('not be shown again'))).toBe(true);
    });
  });

  describe('runWebhookDelete', () => {
    it('deletes webhook by ID', async () => {
      mockClient.webhooks.delete.mockResolvedValue(undefined);
      await runWebhookDelete('we_123', 'sk_test');
      expect(mockClient.webhooks.delete).toHaveBeenCalledWith('we_123');
      expect(consoleOutput.some((l) => l.includes('Deleted'))).toBe(true);
    });
  });

  describe('JSON output mode', () => {
    beforeEach(() => setOutputMode('json'));
    afterEach(() => setOutputMode('human'));

    it('list normalizes list_metadata to listMetadata', async () => {
      mockClient.webhooks.list.mockResolvedValue({
        data: [mockWebhook],
        list_metadata: { before: null, after: 'cursor_a' },
      });
      await runWebhookList('sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.listMetadata).toBeDefined();
      expect(output.listMetadata.after).toBe('cursor_a');
      expect(output).not.toHaveProperty('list_metadata');
    });

    it('list outputs empty data for no results', async () => {
      mockClient.webhooks.list.mockResolvedValue({
        data: [],
        list_metadata: { before: null, after: null },
      });
      await runWebhookList('sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.data).toEqual([]);
    });

    it('create includes secret in JSON output', async () => {
      mockClient.webhooks.create.mockResolvedValue({ ...mockWebhook, secret: 'whsec_abc123' });
      await runWebhookCreate('https://example.com/hook', ['dsync.user.created'], 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.secret).toBe('whsec_abc123');
    });

    it('delete outputs JSON success', async () => {
      mockClient.webhooks.delete.mockResolvedValue(undefined);
      await runWebhookDelete('we_123', 'sk_test');
      const output = JSON.parse(consoleOutput[0]);
      expect(output.status).toBe('ok');
      expect(output.data.id).toBe('we_123');
    });
  });
});
