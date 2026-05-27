import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  resolveCanonicalName,
  extractUserFlags,
  commandTelemetryMiddleware,
  wrapCommandHandler,
} from './command-telemetry.js';

const mockCommandExecuted = vi.fn();
const mockReplaceLastCommandEvent = vi.fn();
const mockRecordTermination = vi.fn();
const mockSetCommandStart = vi.fn();

vi.mock('./analytics.js', () => ({
  analytics: {
    queueProvisionalCommand: (...args: unknown[]) => mockCommandExecuted(...args),
    replaceLastCommandEvent: (...args: unknown[]) => mockReplaceLastCommandEvent(...args),
    recordTermination: (...args: unknown[]) => mockRecordTermination(...args),
    setCommandStart: (...args: unknown[]) => mockSetCommandStart(...args),
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

      expect(mockCommandExecuted).toHaveBeenCalledWith('organization.list', ['json']);
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
      expect(mockReplaceLastCommandEvent).toHaveBeenCalledWith('organization.list', expect.any(Number), true, {
        flags: ['json'],
      });
      const duration = mockReplaceLastCommandEvent.mock.calls[0][1] as number;
      expect(duration).toBeGreaterThanOrEqual(100);
    });

    it('records termination reason "success" after replacing the provisional event', async () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const wrapped = wrapCommandHandler(handler);

      await wrapped({
        __telemetryCommandName: 'organization.list',
        __telemetryStartTime: Date.now(),
        __telemetryFlags: [],
      });

      expect(mockRecordTermination).toHaveBeenCalledWith('success');
      // Order matters: replace re-queues the event, then recordTermination patches it.
      const replaceCallOrder = mockReplaceLastCommandEvent.mock.invocationCallOrder[0];
      const terminationCallOrder = mockRecordTermination.mock.invocationCallOrder[0];
      expect(terminationCallOrder).toBeGreaterThan(replaceCallOrder);
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

      expect(mockReplaceLastCommandEvent).toHaveBeenCalledWith('organization.list', expect.any(Number), false, {
        error,
        flags: [],
      });
    });

    it('records termination reason "crash" with error name on uncaught throw', async () => {
      const error = new TypeError('boom');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = wrapCommandHandler(handler);

      await expect(
        wrapped({
          __telemetryCommandName: 'organization.list',
          __telemetryStartTime: Date.now(),
          __telemetryFlags: [],
        }),
      ).rejects.toBe(error);

      expect(mockRecordTermination).toHaveBeenCalledWith('crash', 'TypeError');
      // Same ordering contract as success path: replace then patch.
      const replaceCallOrder = mockReplaceLastCommandEvent.mock.invocationCallOrder[0];
      const terminationCallOrder = mockRecordTermination.mock.invocationCallOrder[0];
      expect(terminationCallOrder).toBeGreaterThan(replaceCallOrder);
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

  describe('telemetry coverage', () => {
    it('all top-level .command() inline handlers in bin.ts use wrapCommandHandler or are in the skip list', () => {
      const binSource = readFileSync(resolve(__dirname, '../bin.ts'), 'utf-8');

      // Commands that intentionally skip wrapCommandHandler because they have their own
      // session-based telemetry. Keep in sync with SKIP_TELEMETRY_COMMANDS in command-telemetry.ts
      // (root maps to the $0 default handler).
      const INTENTIONAL_SKIPS = new Set(['install', 'dashboard', '$0']);

      const lines = binSource.split('\n');
      const unwrapped: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match the start of an inline yargs handler: `async (argv) =>` or `async () =>`
        if (!/async\s*\((?:argv)?\)\s*=>/.test(line)) continue;
        // Already wrapped on this line
        if (line.includes('wrapCommandHandler(')) continue;
        // Skip yargs middleware (e.g. `.middleware(async (argv) => ...)`)
        if (/\.middleware\(/.test(line)) continue;

        // Walk backwards. The nearest preceding scope-opening line is either:
        //   - `registerSubcommand(...)` — handler is auto-wrapped, skip
        //   - `.command(` — this is the owning top-level command. Capture its name
        //     argument (which may be on the same line or on the next non-empty line).
        // Whichever comes FIRST (closest to this handler line) wins.
        let commandName: string | null = null;
        let isSubcommandHandler = false;
        for (let j = i - 1; j >= Math.max(0, i - 100); j--) {
          const prev = lines[j];
          if (/registerSubcommand\(/.test(prev)) {
            isSubcommandHandler = true;
            break;
          }
          if (/\.command\(/.test(prev)) {
            // Match name on same line, or look at the next non-empty line if .command( ends the line.
            const inline = prev.match(/\.command\(\s*(?:'([^']+)'|"([^"]+)"|\[\s*'([^']+)'|\[\s*"([^"]+)")/);
            if (inline) {
              commandName = inline[1] ?? inline[2] ?? inline[3] ?? inline[4] ?? null;
            } else {
              // .command( with no name on this line — name is on the following line(s).
              for (let k = j + 1; k < i; k++) {
                const nameLine = lines[k].trim();
                if (!nameLine) continue;
                const m = nameLine.match(/^(?:'([^']+)'|"([^"]+)"|\[\s*'([^']+)'|\[\s*"([^"]+)")/);
                if (m) {
                  commandName = m[1] ?? m[2] ?? m[3] ?? m[4] ?? null;
                }
                break;
              }
            }
            break;
          }
        }

        if (isSubcommandHandler) continue;
        if (!commandName) continue;

        // Extract the leading token (e.g. "setup-org <name>" -> "setup-org") for the skip check.
        const firstToken = commandName.split(/\s+/)[0];
        if (INTENTIONAL_SKIPS.has(firstToken)) continue;

        unwrapped.push(`"${commandName}" (bin.ts:${i + 1})`);
      }

      expect(unwrapped).toEqual([]);
    });
  });
});
