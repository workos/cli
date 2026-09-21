import type { CompletionData } from './events.js';
import type { DevCommandResult } from './dev-command.js';
import type { Integration } from './constants.js';
import type { AuthkitApplicationSetup } from './authkit-application-setup.js';

export function applicationSetupNextSteps(setup: AuthkitApplicationSetup): string[] {
  return [
    setup.verified
      ? 'Application URLs were read back and verified; browser flows are not yet tested.'
      : `Application setup is incomplete: ${setup.reason ?? 'Settings have not been verified.'}`,
    `Redirect URI: ${setup.redirectUri} (${setup.callbackRegistered || setup.verified ? 'registered' : 'not registered or verified'})`,
    `Sign-out URI: ${setup.signOutUri}`,
    `Initiate login URI: ${setup.initiateLoginUri} (starts sign-in; never use the callback URI)`,
    ...(setup.homepageUrl !== undefined ? [`Homepage URL: ${setup.homepageUrl}`] : []),
    'Test sign-in, sign-out, protected-page access, and a password-reset or invitation login before calling the integration complete.',
  ];
}

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
  /**
   * Claim command for an unclaimed environment this install actually used
   * (e.g. `workos profile claim`), or undefined for a claimed environment.
   * Resolved by the caller, which owns the config lookup.
   */
  claimCommand?: string;
  applicationSetup?: AuthkitApplicationSetup;
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

  // An unclaimed environment's credentials live only on this machine, so a
  // missed claim loses the environment for good — it leads the next steps for
  // that reason, and because the provision-time notice is printed before
  // scaffolding and the agent run, minutes of output before the install ends.
  const claim = deps.claimCommand
    ? [`Run \`${deps.claimCommand}\` to link this environment to your WorkOS account`]
    : [];

  return {
    integration: ctx.integration,
    devCommand,
    url,
    files,
    nextSteps: [
      ...claim,
      ...(deps.applicationSetup ? applicationSetupNextSteps(deps.applicationSetup) : []),
      ...concrete,
      ...framework,
    ],
    ...(deps.applicationSetup ? { applicationSetup: deps.applicationSetup } : {}),
    docsUrl: deps.docsUrl,
    dashboardUrl: deps.dashboardUrl,
    signInSnippet: deps.signInSnippet,
  };
}
