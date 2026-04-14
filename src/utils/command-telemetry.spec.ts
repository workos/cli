import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resolveCanonicalName, extractUserFlags, commandTelemetryMiddleware, wrapCommandHandler } from './command-telemetry.js';

const mockCommandExecuted = vi.fn();
const mockReplaceLastCommandEvent = vi.fn();

vi.mock('./analytics.js', () => ({
  analytics: {
    commandExecuted: (...args: unknown[]) => mockCommandExecuted(...args),
    replaceLastCommandEvent: (...args: unknown[]) => mockReplaceLastCommandEvent(...args),
  },
}));

vi.mock('../lib/constants.js', () => ({
  WORKOS_TELEMETRY_ENABLED: true,
}));

describe('command-telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveCanonicalName', () => {
    it('resolves aliased commands', () => {
      expect(resolveCanonicalName(['org', 'list'])).toBe('organization.list');
    });

    it('passes through non-aliased commands', () => {
      expect(resolveCanonicalName(['auth', 'login'])).toBe('auth.login');
    });

    it('returns root for empty parts', () => {
      expect(resolveCanonicalName([])).toBe('root');
    });

    it('handles single-part commands', () => {
      expect(resolveCanonicalName(['install'])).toBe('install');
    });

    it('only aliases the first part', () => {
      expect(resolveCanonicalName(['org', 'org'])).toBe('organization.org');
    });
  });

  describe('extractUserFlags', () => {
    it('extracts long flags', () => {
      expect(extractUserFlags(['org', 'list', '--json'])).toEqual(['json']);
    });

    it('extracts short flags', () => {
      expect(extractUserFlags(['-v'])).toEqual(['v']);
    });

    it('handles flags with values', () => {
      expect(extractUserFlags(['--env=staging'])).toEqual(['env']);
    });

    it('deduplicates flags', () => {
      expect(extractUserFlags(['--json', '--json'])).toEqual(['json']);
    });

    it('ignores positionals', () => {
      expect(extractUserFlags(['org', 'list', 'my-org'])).toEqual([]);
    });

    it('ignores multi-char short flags (not real flags)', () => {
      expect(extractUserFlags(['-abc'])).toEqual([]);
    });
  });

  describe('commandTelemetryMiddleware', () => {
    it('queues provisional event with duration=0', async () => {
      const middleware = commandTelemetryMiddleware(['org', 'list', '--json']);
      const argv: Record<string, unknown> = { _: ['org', 'list'] };

      await middleware(argv);

      expect(mockCommandExecuted).toHaveBeenCalledWith('organization.list', 0, true, {
        flags: ['json'],
      });
    });

    it('stores telemetry metadata on argv', async () => {
      const middleware = commandTelemetryMiddleware(['auth', 'login']);
      const argv: Record<string, unknown> = { _: ['auth', 'login'] };

      await middleware(argv);

      expect(argv.__telemetryCommandName).toBe('auth.login');
      expect(argv.__telemetryStartTime).toBeTypeOf('number');
      expect(argv.__telemetryFlags).toEqual([]);
    });
  });

  describe('wrapCommandHandler', () => {
    it('replaces provisional event on success', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommandHandler(handler);
      const argv = {
        __telemetryCommandName: 'organization.list',
        __telemetryStartTime: Date.now() - 100,
        __telemetryFlags: ['json'],
      };

      await wrapped(argv);

      expect(handler).toHaveBeenCalledWith(argv);
      expect(mockReplaceLastCommandEvent).toHaveBeenCalledWith(
        'organization.list',
        expect.any(Number),
        true,
        { flags: ['json'] },
      );
      const duration = mockReplaceLastCommandEvent.mock.calls[0][1] as number;
      expect(duration).toBeGreaterThanOrEqual(100);
    });

    it('replaces provisional event on failure with error', async () => {
      const error = new Error('command failed');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = wrapCommandHandler(handler);
      const argv = {
        __telemetryCommandName: 'organization.list',
        __telemetryStartTime: Date.now(),
        __telemetryFlags: [],
      };

      await expect(wrapped(argv)).rejects.toThrow('command failed');

      expect(mockReplaceLastCommandEvent).toHaveBeenCalledWith(
        'organization.list',
        expect.any(Number),
        false,
        { error, flags: [] },
      );
    });

    it('re-throws the original error', async () => {
      const error = new Error('original');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = wrapCommandHandler(handler);

      await expect(wrapped({ __telemetryStartTime: Date.now() })).rejects.toBe(error);
    });

    it('handles non-Error throws', async () => {
      const handler = vi.fn().mockRejectedValue('string error');
      const wrapped = wrapCommandHandler(handler);

      await expect(
        wrapped({ __telemetryCommandName: 'test', __telemetryStartTime: Date.now(), __telemetryFlags: [] }),
      ).rejects.toBe('string error');

      const errorArg = mockReplaceLastCommandEvent.mock.calls[0][3].error;
      expect(errorArg).toBeInstanceOf(Error);
      expect(errorArg.message).toBe('string error');
    });
  });
});
