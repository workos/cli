import { describe, it, expect } from 'vitest';
import {
  classifyAgentFailure,
  describeAgentFailure,
  formatAgentFailure,
  type AgentFailureKind,
} from './failure-classifier.js';

/**
 * The verbatim strings from the incident, plus the neighbouring shapes that
 * must NOT reclassify. The ordering inside classifyAgentFailure is the entire
 * fix: every `deterministic` row below also matches a transient pattern, so a
 * careless reorder turns them all back into "try again in a few minutes".
 */
const CASES: Array<[message: string, expected: AgentFailureKind]> = [
  // --- The incident. Both of these carry 5xx-shaped text. ---
  ['API Error: 500 {"error":{"type":"internal_error","message":"An unexpected error occurred"}}', 'deterministic'],
  ['API Error: 500 An unexpected error occurred (request id: req_x)', 'deterministic'],
  ['{"error":"upstream_timeout","message":"Upstream server timed out"}', 'deterministic'],
  ['504 Upstream server timed out', 'deterministic'],
  ['Streaming is strongly recommended for operations that may take longer than 10 minutes', 'deterministic'],
  ['400 max_tokens: 64000 > 32000, which is the maximum allowed', 'deterministic'],

  // --- Genuinely transient. This copy is correct and must not regress. ---
  ['503 Service Unavailable', 'service_outage'],
  ['{"type":"overloaded_error","message":"Overloaded"}', 'service_outage'],
  ['server_error: service overloaded', 'service_outage'],
  ['API Error: 502 Bad Gateway', 'service_outage'],

  // --- Rate limiting, checked before any 5xx branch. ---
  ['API Error: 429 rate_limit_exceeded', 'rate_limited'],
  ['429 Too Many Requests', 'rate_limited'],
  ['This organization has exceeded its rate limit', 'rate_limited'],

  // --- Everything else keeps its previous verdict. ---
  ['fetch failed', 'network'],
  ['connect ECONNREFUSED 127.0.0.1:8000', 'network'],
  ['process exited with code 1', 'process_exit'],
  ['API Error: 401 unauthorized', 'auth'],
  ["ENOENT: no such file or directory, open '/proj/package.json'", 'missing_path'],
  ['Some other failure', 'unknown'],
  ['', 'unknown'],
];

describe('classifyAgentFailure', () => {
  for (const [message, expected] of CASES) {
    it(`classifies ${JSON.stringify(message.slice(0, 60))} as ${expected}`, () => {
      expect(classifyAgentFailure(message)).toBe(expected);
    });
  }

  it('prefers rate_limited when a message carries both 429 and 500', () => {
    expect(classifyAgentFailure('API Error: 429 after retrying a 500 An unexpected error occurred')).toBe(
      'rate_limited',
    );
  });

  it('prefers deterministic when a message carries both the generic-500 text and internal_error', () => {
    // This is the exact shape that used to fall into service_outage: the
    // deterministic phrase and the transient token arrive in the same body.
    expect(classifyAgentFailure('500 internal_error: An unexpected error occurred')).toBe('deterministic');
  });

  it('does not read "author" as an auth failure or "Module not found" as a missing path', () => {
    expect(classifyAgentFailure('author field is required in package.json')).toBe('unknown');
    expect(classifyAgentFailure('Module not found: Cannot resolve "@workos-inc/authkit-nextjs"')).toBe('unknown');
  });
});

describe('describeAgentFailure', () => {
  it('never advises waiting for a deterministic failure', () => {
    const { headline, detail } = describeAgentFailure('deterministic');

    expect(headline).not.toMatch(/temporarily unavailable/i);
    expect(`${headline} ${detail}`).not.toMatch(/few minutes|try again shortly|wait a minute/i);
    expect(detail).toMatch(/--debug/);
  });

  it('keeps the transient copy for a real outage', () => {
    expect(describeAgentFailure('service_outage').headline).toMatch(/temporarily unavailable/i);
    expect(describeAgentFailure('service_outage').detail).toMatch(/few minutes/i);
  });

  it('falls back to the raw message for kinds with no better copy', () => {
    expect(describeAgentFailure('unknown').headline).toBeNull();
    expect(describeAgentFailure('missing_path').headline).toBeNull();
    expect(formatAgentFailure('unknown', 'Something broke')).toBe('Something broke');
  });

  /**
   * installer-core's emitError re-emits the *rendered* message onto the `error`
   * event, so the adapters classify our own copy rather than the raw SDK text.
   * If rendering does not round-trip, the deterministic verdict is lost between
   * runAgent and the terminal — which is the bug this phase exists to fix.
   */
  it.each(['deterministic', 'service_outage', 'rate_limited'] as const)(
    'round-trips its own rendered copy for %s',
    (kind) => {
      expect(classifyAgentFailure(formatAgentFailure(kind, 'raw'))).toBe(kind);
    },
  );
});
