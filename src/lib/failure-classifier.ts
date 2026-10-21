/**
 * Single source of truth for what an agent failure means and what to tell the
 * user about it.
 *
 * Three call sites used to re-derive this independently — `handleSDKMessage` in
 * `agent-interface.ts`, `CLIAdapter.handleError`, `HeadlessAdapter.handleError` —
 * each with its own copy of a "5xx means transient" regex. All three were wrong
 * about the same thing: the WorkOS LLM gateway returns a generic 500 for
 * failures that are entirely deterministic (its `toApiErrorResponse` fallback
 * fires whenever the Anthropic SDK throws a status-less error, including the
 * `max_tokens` guard), so "try again in a few minutes" sent users round a
 * four-minute loop that could never succeed.
 */

import { formatWorkOSCommand } from '../utils/command-invocation.js';

export type AgentFailureKind =
  /** Retry helps, after a wait. */
  | 'rate_limited'
  /** Retry helps; a transient upstream problem. */
  | 'service_outage'
  /** Retry does NOT help; same input, same failure. */
  | 'deterministic'
  | 'network'
  | 'process_exit'
  | 'auth'
  | 'missing_path'
  | 'unknown';

/**
 * Headline for the `deterministic` kind, kept as a named constant because
 * `classifyAgentFailure` also matches it: `installer-core`'s `emitError`
 * re-emits the *already rendered* message onto the `error` event, so the
 * adapters classify our own copy. Rendering has to round-trip or the
 * deterministic verdict is silently lost on the way to the terminal.
 */
const DETERMINISTIC_HEADLINE = 'The AI service could not complete this request.';

/**
 * Classify an agent failure message. The key distinction is whether retrying
 * can plausibly succeed. A gateway 500 is NOT automatically transient: the
 * WorkOS LLM gateway returns a generic 500 for client-side SDK validation
 * failures (`llm-gateway.controller.ts` `toApiErrorResponse`), which recur on
 * every attempt.
 *
 * Ordering is the whole design. The deterministic patterns are tested *before*
 * the generic 5xx branch; flip them and the gateway's generic-500 text falls
 * back into `service_outage` exactly as it did before this function existed.
 *
 * Matching is word-boundary / code-based so `author` does not read as `auth`
 * and `Module not found` does not read as a missing directory.
 */
export function classifyAgentFailure(message: string): AgentFailureKind {
  // Rate limiting first — it is a 429, and it is the one case with specific advice.
  if (/\b429\b/.test(message) || /\brate.?limit/i.test(message)) return 'rate_limited';

  // Deterministic failures that WEAR a 5xx. Must stay above the generic 5xx branch.
  //
  // "An unexpected error occurred" is the gateway's generic-branch message
  // (llm-gateway.controller.ts, toApiErrorResponse) and is the precise
  // signature of "the SDK threw something with no status".
  if (/an unexpected error occurred/i.test(message)) return 'deterministic';
  // The proxy's own 504 body (credential-proxy.ts). A request that blew the
  // socket timeout will blow it again; that is not an outage.
  if (/upstream_timeout|upstream server timed out/i.test(message)) return 'deterministic';
  // Request-shape rejections from the Anthropic SDK / gateway guard rails.
  if (/streaming is (strongly recommended|required)|max_tokens/i.test(message)) return 'deterministic';
  // Our own rendered copy, so a re-classification downstream round-trips.
  if (message.includes(DETERMINISTIC_HEADLINE)) return 'deterministic';

  // Genuinely transient upstream states.
  if (/overloaded/i.test(message) || /\b503\b/.test(message)) return 'service_outage';
  if (/server_error|internal_error|service.*unavailable/i.test(message)) return 'service_outage';
  if (/\b50[0-9]\b/.test(message)) return 'service_outage';

  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message)) return 'network';
  if (/process exited with code/i.test(message)) return 'process_exit';
  if (/\b(401|403|unauthorized|forbidden|authentication|authorization)\b/i.test(message)) return 'auth';
  if (/\bENOENT\b/.test(message)) return 'missing_path';
  return 'unknown';
}

/**
 * User-facing copy per kind. Adapters render these; they do not re-derive them.
 *
 * A `null` headline means "there is nothing better to say than the raw message" —
 * the caller renders the message it was given. A `null` detail means the caller
 * supplies its own next step (the CLI adapter's `--debug` hint).
 */
export function describeAgentFailure(kind: AgentFailureKind): { headline: string | null; detail: string | null } {
  switch (kind) {
    case 'rate_limited':
      return {
        headline: 'The AI service is currently rate-limited.',
        detail: 'Please wait a minute and try again.',
      };
    case 'service_outage':
      return {
        headline: 'The AI service is temporarily unavailable.',
        detail: 'This is usually resolved within a few minutes. Please try again shortly.',
      };
    case 'deterministic':
      // Neither "wait a few minutes" (it will fail identically) nor a flat "do
      // not retry" (a real outage can wear this shape) — say what is true.
      return {
        headline: DETERMINISTIC_HEADLINE,
        detail:
          'The same request is likely to fail the same way, so waiting will not help. Re-run with --debug to see the underlying error.',
      };
    case 'network':
      return {
        headline: 'Could not connect to the AI service.',
        detail: 'Check your internet connection and try again.',
      };
    case 'process_exit':
      return {
        headline: 'The AI agent process exited unexpectedly.',
        detail: 'Try running again. If this persists, run with --debug for details.',
      };
    case 'auth':
      return {
        headline: 'Authentication failed.',
        detail: `Try running: ${formatWorkOSCommand('auth logout')} && ${formatWorkOSCommand('install')}`,
      };
    case 'missing_path':
      return {
        headline: null,
        detail: 'Make sure you are running this in your project directory.',
      };
    case 'unknown':
      return { headline: null, detail: null };
  }
}

/**
 * Flatten a classified failure into one string, for the paths that carry a
 * single error message (`runAgent`'s `errorMessage`, the headless NDJSON
 * `message`) rather than a headline plus a hint.
 */
export function formatAgentFailure(kind: AgentFailureKind, message: string): string {
  const { headline, detail } = describeAgentFailure(kind);
  if (!headline) return message;
  return detail ? `${headline} ${detail}` : headline;
}
