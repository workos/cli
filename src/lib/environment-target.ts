/**
 * Environment targeting for dashboard-plane (account-plane) commands.
 *
 * Under the REST plane the API key *is* the environment. Under the dashboard
 * plane the server resolves the caller's team and — when no environment header
 * is sent, or the sent ID isn't recognized as the team's — silently falls back
 * to the team's production environment (see `dashboard-graphql.ts`). That
 * fallback is exactly the hazard this module exists to kill:
 *
 * **Invariant: environment-scoped dashboard requests always carry an
 * environment ID resolved through `resolveEnvironmentTarget()`, and a
 * stored-but-unrecognized ID produces a structured error — never a request the
 * server would misroute to production.**
 *
 * Resolution precedence mirrors the API-key chain (`api-key.ts`):
 * `--environment-id` flag → active profile's stored `environmentId` → clientId
 * join against the team's environments → one-time picker (human mode) →
 * structured `environment_unresolved` error.
 *
 * Staleness tactic: **mutations pre-validate, reads trust.** A mutation
 * validates the effective ID against a fresh fetch of the team's environments
 * (one extra round trip on writes only); an unrecognized ID exits with
 * `environment_stale` before any operation request is issued. Reads use the
 * stored ID directly — worst case a read errors server-side or returns empty,
 * but nothing is ever written to the wrong environment. Whenever the team's
 * environments are fetched anyway, the active profile is opportunistically
 * healed via its clientId join.
 */

import clack from '../utils/clack.js';
import { getConfig, getActiveEnvironment, setProfileEnvironmentId } from './config-store.js';
import { dashboardGraphqlRequest, DashboardGraphqlError } from './dashboard-graphql.js';
import { getOperation, resolveExecutableDocument } from '../catalog/operation.js';
import { refreshIfExpired, DASHBOARD_ERROR_MESSAGES } from './command-auth.js';
import { exitWithError } from '../utils/output.js';
import { isPromptAllowed } from '../utils/interaction-mode.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';

export interface EnvironmentTargetOptions {
  /** `--environment-id` flag value (or an explicit positional target). */
  flagValue?: string;
  /** Mutations pre-validate the effective ID; reads trust stored state. */
  forMutation: boolean;
}

export interface EnvironmentTarget {
  environmentId: string;
  source: 'flag' | 'profile' | 'picker';
}

interface TeamEnvironment {
  id: string;
  name: string | null;
  sandbox?: boolean | null;
  clientId?: string | null;
}

interface TeamProjectsData {
  currentTeam: {
    projectsV2: Array<{ environments: TeamEnvironment[] | null }> | null;
  } | null;
}

/** The two remedies every unresolved/stale message must name. */
function remedies(): string {
  return `Pass --environment-id, or run \`${formatWorkOSCommand('env switch')}\` to select an environment.`;
}

/**
 * Fetch the team's environments (projects → environments) with the caller's
 * bearer. Throws the underlying transport/server error — callers decide
 * whether that is fatal (`resolveEnvironmentTarget`) or best-effort
 * (`tryResolveProfileEnvironmentId`).
 */
async function fetchTeamEnvironments(token: string): Promise<TeamEnvironment[]> {
  const op = getOperation('teamProjectsV2');
  const data = await dashboardGraphqlRequest<TeamProjectsData>(resolveExecutableDocument(op), { token });
  const projects = data.currentTeam?.projectsV2 ?? [];
  return projects.flatMap((project) => project.environments ?? []);
}

/**
 * Opportunistic healing: whenever the team's environments are fetched anyway,
 * re-join the active profile's clientId and persist the environment ID if it
 * changed (e.g. the environment was recreated). Profiles without a clientId
 * are never touched. Note: a picker choice persisted onto a clientId-bearing
 * profile (the foreign-profile fall-through, where the join missed) could be
 * overridden here if that clientId later appears in the team's list — the
 * join is then the fresher truth for this team, so that override is desired.
 */
function healActiveProfile(environments: TeamEnvironment[]): void {
  const config = getConfig();
  if (!config?.activeEnvironment) return;
  const profile = config.environments[config.activeEnvironment];
  if (!profile?.clientId) return;
  const match = environments.find((env) => env.clientId === profile.clientId);
  if (!match) return;
  setProfileEnvironmentId(config.activeEnvironment, match.id);
}

function exitStale(environmentId: string): never {
  exitWithError({
    code: 'environment_stale',
    message:
      `Environment "${environmentId}" was not found in your WorkOS team — it may have been deleted or recreated. ` +
      remedies(),
  });
}

async function promptForEnvironment(environments: TeamEnvironment[]): Promise<string | null> {
  const choice = await clack.select({
    message: 'Select the WorkOS environment to target',
    options: environments.map((env) => ({
      value: env.id,
      label: `${env.name ?? env.id}${env.sandbox ? ' [Sandbox]' : ''}`,
      hint: env.id,
    })),
  });
  if (clack.isCancel(choice)) return null;
  return String(choice);
}

/**
 * Single choke point answering: which environment does this invocation target,
 * and is that answer safe to act on?
 *
 * Never resolves to "no environment": when nothing can be determined it exits
 * with a structured `environment_unresolved` error (proceeding without the
 * header is forbidden — it would hit the server's silent production fallback).
 */
export async function resolveEnvironmentTarget(
  token: string,
  options: EnvironmentTargetOptions,
): Promise<EnvironmentTarget> {
  const flagValue = options.flagValue?.trim() || undefined;

  // Fast paths — reads trust explicit/stored state with no extra round trip.
  if (!options.forMutation) {
    if (flagValue) return { environmentId: flagValue, source: 'flag' };
    const profile = getActiveEnvironment();
    if (profile?.environmentId) return { environmentId: profile.environmentId, source: 'profile' };
  }

  // Everything past here needs the team's environment list (pre-validation,
  // clientId join, or the picker).
  let environments: TeamEnvironment[];
  try {
    environments = await fetchTeamEnvironments(token);
  } catch (error) {
    // A 403 is not transient — the team lacks the capability or the account
    // isn't team-backed. Surface the forbidden copy instead of a retry hint.
    if (error instanceof DashboardGraphqlError && error.code === 'forbidden') {
      exitWithError({ code: 'forbidden', message: DASHBOARD_ERROR_MESSAGES.forbidden });
    }
    exitWithError({
      code: 'environment_unresolved',
      message: `Could not resolve the target WorkOS environment (network or server error). Try again. ${remedies()}`,
    });
  }

  if (environments.length === 0) {
    exitWithError({
      code: 'environment_unresolved',
      message:
        'No WorkOS environments are visible to this account. Check your team access in the WorkOS dashboard. ' +
        remedies(),
    });
  }

  // Heal before validating: a stale stored ID whose profile clientId still
  // joins to a live environment is silently repaired instead of erroring.
  healActiveProfile(environments);

  if (flagValue) {
    // An explicit-but-mistyped ID hitting the server's silent fallback on a
    // delete is exactly the hazard the invariant exists to kill — validate
    // flag-supplied IDs like stored ones.
    if (!environments.some((env) => env.id === flagValue)) {
      exitStale(flagValue);
    }
    return { environmentId: flagValue, source: 'flag' };
  }

  // Re-read: healing above may have just stored a fresh ID.
  const profile = getActiveEnvironment();
  if (profile?.environmentId) {
    if (!environments.some((env) => env.id === profile.environmentId)) {
      exitStale(profile.environmentId);
    }
    return { environmentId: profile.environmentId, source: 'profile' };
  }

  if (isPromptAllowed()) {
    const choice = await promptForEnvironment(environments);
    if (choice === null) exitWithCode(ExitCode.CANCELLED);
    // Persist so the picker runs at most once per profile (no-op without an
    // active profile — the choice then applies to this invocation only).
    const config = getConfig();
    if (config?.activeEnvironment) {
      setProfileEnvironmentId(config.activeEnvironment, choice);
    }
    return { environmentId: choice, source: 'picker' };
  }

  exitWithError({
    code: 'environment_unresolved',
    message: `Could not determine which WorkOS environment to target. ${remedies()}`,
  });
}

export interface TryResolveProfileOptions {
  /** Bearer to use; when omitted, a stored session is refreshed if possible. */
  token?: string;
  /** Offer the one-time picker in human mode when the clientId join misses. */
  allowPicker?: boolean;
}

/**
 * Best-effort resolution for a named profile, used by `env add`, `env switch`,
 * and post-login staging provisioning. Joins via the profile's clientId; in
 * human mode (and with `allowPicker`) falls back to the one-time picker.
 *
 * Never throws and never exits: profile creation/switch/login must succeed
 * regardless — resolution defers to first dashboard-command use.
 */
export async function tryResolveProfileEnvironmentId(
  envKey: string,
  options: TryResolveProfileOptions = {},
): Promise<boolean> {
  try {
    const config = getConfig();
    const profile = config?.environments[envKey];
    if (!profile) return false;
    if (profile.environmentId) return true;

    const token = options.token ?? (await refreshIfExpired())?.accessToken;
    if (!token) return false;

    const environments = await fetchTeamEnvironments(token);
    if (environments.length === 0) return false;

    if (profile.clientId) {
      const match = environments.find((env) => env.clientId === profile.clientId);
      if (match) {
        setProfileEnvironmentId(envKey, match.id);
        return true;
      }
      // A clientId that joins nothing usually means a foreign profile (an API
      // key from another team) — never guess. Fall through to the picker in
      // human mode; otherwise defer to first dashboard-command use.
    }

    if (options.allowPicker && isPromptAllowed()) {
      const choice = await promptForEnvironment(environments);
      if (choice === null) return false; // cancel skips resolution, never aborts the caller
      setProfileEnvironmentId(envKey, choice);
      return true;
    }

    return false;
  } catch {
    return false;
  }
}
