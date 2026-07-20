import type { CompletionData } from './events.js';
import type { DevCommandResult } from './dev-command.js';
import type { Integration } from './constants.js';

/**
 * Machine-context slice needed to build completion data.
 */
export interface CompletionContext {
  integration: string;
  changedFiles?: string[];
  installDir: string;
}

/**
 * Injected dependencies. The impure lookups (registry/settings) are resolved by
 * the caller and passed as plain values so the builder stays pure + unit-testable.
 */
export interface CompletionDataDeps {
  resolveDevCommand: (dir: string) => Promise<DevCommandResult>;
  detectPort: (integration: Integration, dir: string) => number;
  docsUrl: string;
  dashboardUrl: string;
  /** Enriched getOutroNextSteps copy for the framework */
  frameworkNextSteps?: string[];
  /** Per-framework "add a sign-in link" snippet */
  signInSnippet?: string;
}

/**
 * Build the structured completion payload for a successful install.
 *
 * Deterministic given its inputs. The dev command is derived from the
 * lockfile-aware `resolveDevCommand` (never from context.packageManager, which
 * is flag/env-derived and unreliable). Copy fields are injected by the caller.
 */
export async function buildCompletionData(ctx: CompletionContext, deps: CompletionDataDeps): Promise<CompletionData> {
  const dev = await deps.resolveDevCommand(ctx.installDir);
  const devCommand = [dev.command, ...dev.args].join(' ');
  const port = deps.detectPort(ctx.integration as Integration, ctx.installDir);
  const url = `http://localhost:${port}`;
  const files = ctx.changedFiles ?? [];

  const concrete = [
    `Run \`${devCommand}\` to start your dev server`,
    `Open ${url} to test authentication`,
    ...(deps.signInSnippet ? [deps.signInSnippet] : []),
  ];
  // Drop the framework's generic "start dev server" line — the concrete step
  // above already names the exact lockfile-aware command.
  const framework = (deps.frameworkNextSteps ?? []).filter((s) => !/start .*dev(elopment)? server/i.test(s));

  return {
    integration: ctx.integration,
    devCommand,
    url,
    files,
    nextSteps: [...concrete, ...framework],
    docsUrl: deps.docsUrl,
    dashboardUrl: deps.dashboardUrl,
    signInSnippet: deps.signInSnippet,
  };
}
