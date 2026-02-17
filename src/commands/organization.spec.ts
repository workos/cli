import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock workos-api
vi.mock('../lib/workos-api.js', () => ({
  workosRequest: vi.fn(),
  WorkOSApiError: class WorkOSApiError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
      public readonly code?: string,
      public readonly errors?: Array<{ message: string }>,
    ) {
      super(message);
      this.name = 'WorkOSApiError';
    }
  },
}));

const { workosRequest } = await import('../lib/workos-api.js');
const mockRequest = vi.mocked(workosRequest);

const { runOrgCreate, runOrgUpdate, runOrgGet, runOrgList, runOrgDelete, parseDomainArgs } =
  await import('./organization.js');

describe('organization commands', () => {
  let consoleOutput: string[];

  beforeEach(() => {
    mockRequest.mockReset();
    consoleOutput = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('parseDomainArgs', () => {
    it('parses domain:state format', () => {
      expect(parseDomainArgs(['foo.com:verified'])).toEqual([{ domain: 'foo.com', state: 'verified' }]);
    });

    it('defaults state to verified', () => {
      expect(parseDomainArgs(['foo.com'])).toEqual([{ domain: 'foo.com', state: 'verified' }]);
    });

    it('parses multiple domains', () => {
      const result = parseDomainArgs(['foo.com:verified', 'bar.com:pending']);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({ domain: 'bar.com', state: 'pending' });
    });

    it('returns empty array for no args', () => {
      expect(parseDomainArgs([])).toEqual([]);
    });
  });

  describe('runOrgCreate', () => {
    it('creates org with name only', async () => {
      mockRequest.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', [], 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: '/organizations',
          body: { name: 'Test' },
        }),
      );
    });

    it('creates org with domain data', async () => {
      mockRequest.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', ['foo.com:pending'], 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            name: 'Test',
            domain_data: [{ domain: 'foo.com', state: 'pending' }],
          },
        }),
      );
    });

    it('outputs created message and JSON', async () => {
      mockRequest.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgCreate('Test', [], 'sk_test');
      expect(consoleOutput.some((l) => l.includes('Created organization'))).toBe(true);
    });
  });

  describe('runOrgUpdate', () => {
    it('updates org name', async () => {
      mockRequest.mockResolvedValue({ id: 'org_123', name: 'Updated' });
      await runOrgUpdate('org_123', 'Updated', 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          path: '/organizations/org_123',
          body: { name: 'Updated' },
        }),
      );
    });

    it('updates org with domain data', async () => {
      mockRequest.mockResolvedValue({ id: 'org_123', name: 'Updated' });
      await runOrgUpdate('org_123', 'Updated', 'sk_test', 'foo.com', 'pending');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            name: 'Updated',
            domain_data: [{ domain: 'foo.com', state: 'pending' }],
          },
        }),
      );
    });
  });

  describe('runOrgGet', () => {
    it('fetches and prints org as JSON', async () => {
      mockRequest.mockResolvedValue({ id: 'org_123', name: 'Test', domains: [] });
      await runOrgGet('org_123', 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', path: '/organizations/org_123' }),
      );
      // Should print JSON
      expect(consoleOutput.some((l) => l.includes('org_123'))).toBe(true);
    });
  });

  describe('runOrgList', () => {
    it('lists orgs in table format', async () => {
      mockRequest.mockResolvedValue({
        data: [
          {
            id: 'org_123',
            name: 'FooCorp',
            domains: [{ id: 'd_1', domain: 'foo.com', state: 'verified' }],
          },
        ],
        list_metadata: { before: null, after: null },
      });
      await runOrgList({}, 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', path: '/organizations' }));
      // Should contain table data
      expect(consoleOutput.some((l) => l.includes('FooCorp'))).toBe(true);
    });

    it('passes filter params', async () => {
      mockRequest.mockResolvedValue({ data: [], list_metadata: { before: null, after: null } });
      await runOrgList({ domain: 'foo.com', limit: 5, order: 'desc' }, 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ domains: 'foo.com', limit: 5, order: 'desc' }),
        }),
      );
    });

    it('handles empty results', async () => {
      mockRequest.mockResolvedValue({ data: [], list_metadata: { before: null, after: null } });
      await runOrgList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('No organizations found'))).toBe(true);
    });

    it('shows pagination cursors', async () => {
      mockRequest.mockResolvedValue({
        data: [{ id: 'org_1', name: 'Test', domains: [] }],
        list_metadata: { before: 'cursor_b', after: 'cursor_a' },
      });
      await runOrgList({}, 'sk_test');
      expect(consoleOutput.some((l) => l.includes('cursor_b'))).toBe(true);
      expect(consoleOutput.some((l) => l.includes('cursor_a'))).toBe(true);
    });
  });

  describe('runOrgDelete', () => {
    it('deletes org and prints confirmation', async () => {
      mockRequest.mockResolvedValue(null);
      await runOrgDelete('org_123', 'sk_test');
      expect(mockRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'DELETE', path: '/organizations/org_123' }),
      );
      expect(consoleOutput.some((l) => l.includes('Deleted') && l.includes('org_123'))).toBe(true);
    });
  });
});
