/**
 * `workos feature-flag` — feature-flag management on the dashboard account
 * plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 5): the
 * subcommand surface (list/get/enable/disable/add-target/remove-target) is
 * unchanged, but every operation now runs catalog-backed dashboard operations
 * with the user's OAuth bearer. Output shapes are new curated shapes (approved
 * breaking change); the authoritative examples live in `feature-flag.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - The backing queries are PROJECT-scoped, so every subcommand first derives
 *   the active environment's project from the team's project list (one extra
 *   read).
 * - Flag state is per-environment server-side; the curated shapes report the
 *   ACTIVE environment's state (`enabled`, targeting). A flag with no state in
 *   the target environment errors `not_found` on enable/disable/targeting.
 * - The per-environment update mutation REPLACES the flag's target lists, so
 *   enable/disable/add-target/remove-target read-merge-write: they fetch the
 *   flag first and always send the full current targeting alongside the change.
 * - Targets are typed by ID prefix (`user_` / `org_`), mirroring the REST
 *   target endpoint's contract; other prefixes are refused loudly.
 *
 * Safety posture per the manifest: all mutations are reversible configuration
 * toggles (ciPolicy `allow`) — no confirmation gates, matching REST behavior.
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { executeDashboardOperation } from '../lib/dashboard-operation.js';
import { getOperation } from '../catalog/operation.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { enumOut } from '../utils/output-conventions.js';
import { normalizeOrder, printDetailFields, printPaginationFooter } from '../utils/resource-command.js';
import { formatTable } from '../utils/table.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

interface FlagEnvironmentNode {
  id: string;
  environmentId: string;
  flagEnabled?: boolean | null;
  defaultEnabled?: boolean | null;
  accessType?: string | null;
  organizations?: Array<{ id: string; name?: string | null }> | null;
  users?: Array<{ id: string; email?: string | null }> | null;
}

interface FlagNode {
  id: string;
  name?: string | null;
  slug: string;
  description?: string | null;
  flagEnvironments?: FlagEnvironmentNode[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: Array<{ id: string; name?: string | null }> | null;
}

function environmentStateFor(flag: FlagNode, environmentId: string): FlagEnvironmentNode | undefined {
  return (flag.flagEnvironments ?? []).find((state) => state.environmentId === environmentId);
}

/**
 * The curated flag list shape — `enabled` is the ACTIVE environment's state.
 * camelCase, stable keys, no internal fields; see feature-flag.spec.ts for the
 * authoritative example.
 */
function shapeFlag(flag: FlagNode, environmentId: string) {
  return {
    id: flag.id,
    slug: flag.slug,
    name: flag.name ?? null,
    description: flag.description ?? null,
    enabled: environmentStateFor(flag, environmentId)?.flagEnabled ?? false,
    createdAt: flag.createdAt ?? null,
    updatedAt: flag.updatedAt ?? null,
  };
}

/** The curated `get` shape: the list shape plus the active environment's targeting. */
function shapeFlagDetail(flag: FlagNode, environmentId: string) {
  const state = environmentStateFor(flag, environmentId);
  return {
    ...shapeFlag(flag, environmentId),
    defaultEnabled: state?.defaultEnabled ?? false,
    accessType: enumOut(state?.accessType),
    organizationTargets: (state?.organizations ?? []).map((org) => ({ id: org.id, name: org.name ?? null })),
    userTargets: (state?.users ?? []).map((user) => ({ id: user.id, email: user.email ?? null })),
    tags: (flag.tags ?? []).map((tag) => tag.name ?? tag.id),
  };
}

interface TeamProjectsData {
  currentTeam: {
    projectsV2: Array<{ id: string; environments: Array<{ id: string }> | null }> | null;
  } | null;
}

/**
 * The flag operations are project-scoped: derive the project that owns the
 * resolved environment from the team's project list. A resolved environment
 * that joins no project means the stored ID went stale — same remedy as the
 * environment resolver's staleness error.
 */
async function resolveProjectId(token: string, environmentId: string): Promise<string> {
  const op = getOperation('teamProjectsV2');
  // Team-scoped read: deliberately no environment header.
  const data = await executeDashboardOperation<TeamProjectsData>(op, { token });

  const projects = data.currentTeam?.projectsV2 ?? [];
  const project = projects.find((candidate) =>
    (candidate.environments ?? []).some((environment) => environment.id === environmentId),
  );
  if (!project) {
    exitWithError({
      code: 'environment_stale',
      message:
        `Environment "${environmentId}" was not found in your WorkOS team — it may have been deleted or recreated. ` +
        `Pass --environment-id, or run \`${formatWorkOSCommand('profile switch')}\` to select an environment.`,
    });
  }
  return project.id;
}

export interface FeatureFlagListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runFeatureFlagList(options: FeatureFlagListOptions = {}): Promise<void> {
  const order = normalizeOrder(options.order);
  const token = await requireCommandToken();
  const op = getOperation('flags');

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });
  const projectId = await resolveProjectId(token, environmentId);

  const data = await executeDashboardOperation<{
    flagsForProject: {
      data: FlagNode[];
      listMetadata: { before: string | null; after: string | null };
    } | null;
  }>(op, {
    token,
    variables: {
      projectId,
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
      ...(options.before ? { before: options.before } : {}),
      ...(options.after ? { after: options.after } : {}),
      ...(order ? { order } : {}),
    },
    environmentId,
  });

  const flags = (data.flagsForProject?.data ?? []).map((flag) => shapeFlag(flag, environmentId));
  const pagination = {
    before: data.flagsForProject?.listMetadata?.before ?? null,
    after: data.flagsForProject?.listMetadata?.after ?? null,
  };

  if (isJsonMode()) {
    outputJson({ flags, pagination });
    return;
  }
  if (flags.length === 0) {
    console.log('No feature flags found.');
    return;
  }

  const rows = flags.map((flag) => [
    flag.slug,
    flag.name ?? chalk.dim('-'),
    flag.enabled ? chalk.green('Yes') : chalk.red('No'),
    flag.description ?? chalk.dim('-'),
  ]);
  console.log(
    formatTable([{ header: 'Slug' }, { header: 'Name' }, { header: 'Enabled' }, { header: 'Description' }], rows),
  );

  printPaginationFooter(pagination);
}

export interface FeatureFlagEnvironmentOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

/** Fetch a flag by slug within the resolved environment's project, or exit not_found. */
async function requireFlagBySlug(
  token: string,
  environmentId: string,
  projectId: string,
  slug: string,
): Promise<FlagNode> {
  const op = getOperation('flagBySlug');
  const data = await executeDashboardOperation<{ flagBySlug: FlagNode | null }>(op, {
    token,
    variables: { projectId, slug },
    environmentId,
  });
  if (!data.flagBySlug) {
    exitWithError({ code: 'not_found', message: `Feature flag "${slug}" was not found.` });
  }
  return data.flagBySlug;
}

export async function runFeatureFlagGet(slug: string, options: FeatureFlagEnvironmentOptions = {}): Promise<void> {
  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: false,
  });
  const projectId = await resolveProjectId(token, environmentId);
  const flag = shapeFlagDetail(await requireFlagBySlug(token, environmentId, projectId, slug), environmentId);

  if (isJsonMode()) {
    outputJson({ flag });
    return;
  }

  const fields: Array<[string, unknown]> = [
    ['Slug', flag.slug],
    ['Name', flag.name],
    ['Enabled', flag.enabled ? 'Yes' : 'No'],
    ['Description', flag.description],
    ['Access type', flag.accessType],
    [
      'Organization targets',
      flag.organizationTargets.length > 0 ? flag.organizationTargets.map((t) => t.id).join(', ') : null,
    ],
    ['User targets', flag.userTargets.length > 0 ? flag.userTargets.map((t) => t.id).join(', ') : null],
    ['Created', flag.createdAt],
  ];
  printDetailFields(fields);
}

/**
 * Resolve the flag's state record for the target environment, or exit
 * not_found (the flag exists but has no state in this environment).
 */
function requireEnvironmentState(flag: FlagNode, slug: string, environmentId: string): FlagEnvironmentNode {
  const state = environmentStateFor(flag, environmentId);
  if (!state) {
    exitWithError({
      code: 'not_found',
      message: `Feature flag "${slug}" is not configured in this environment.`,
    });
  }
  return state;
}

/**
 * Issue the per-environment update. The mutation REQUIRES the full state
 * (enabled/default/access type) and REPLACES the target lists — callers merge
 * their change into the freshly fetched state and pass everything back.
 */
async function executeFlagEnvironmentUpdate(
  token: string,
  environmentId: string,
  slug: string,
  state: FlagEnvironmentNode,
  overrides: { flagEnabled?: boolean; organizationIds?: string[]; userIds?: string[] },
): Promise<void> {
  const op = getOperation('updateFlagEnvironment');

  const data = await executeDashboardOperation<{
    updateFlagEnvironment:
      | { __typename: 'FlagEnvironmentUpdated'; flagEnvironment: FlagEnvironmentNode }
      | { __typename: 'FlagEnvironmentNotFound'; flagEnvironmentId: string };
  }>(op, {
    token,
    variables: {
      input: {
        flagEnvironmentId: state.id,
        flagEnabled: overrides.flagEnabled ?? state.flagEnabled ?? false,
        defaultEnabled: state.defaultEnabled ?? false,
        accessType: enumOut(state.accessType) ?? 'none',
        organizationIds: overrides.organizationIds ?? (state.organizations ?? []).map((org) => org.id),
        userIds: overrides.userIds ?? (state.users ?? []).map((user) => user.id),
      },
    },
    environmentId,
  });

  const result = data.updateFlagEnvironment;
  if (result.__typename === 'FlagEnvironmentNotFound') {
    exitWithError({ code: 'not_found', message: `Feature flag "${slug}" is not configured in this environment.` });
  }
  if (result.__typename !== 'FlagEnvironmentUpdated') {
    exitWithError({ code: 'unexpected_result', message: `Could not update feature flag "${slug}".` });
  }
}

async function setFlagEnabled(slug: string, enabled: boolean, options: FeatureFlagEnvironmentOptions): Promise<void> {
  const token = await requireCommandToken();

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });
  const projectId = await resolveProjectId(token, environmentId);
  const flag = await requireFlagBySlug(token, environmentId, projectId, slug);
  const state = requireEnvironmentState(flag, slug, environmentId);

  await executeFlagEnvironmentUpdate(token, environmentId, slug, state, { flagEnabled: enabled });

  if (isJsonMode()) {
    outputJson(enabled ? { enabled: slug } : { disabled: slug });
    return;
  }
  outputSuccess(`${enabled ? 'Enabled' : 'Disabled'} feature flag ${chalk.bold(slug)}`);
}

export async function runFeatureFlagEnable(slug: string, options: FeatureFlagEnvironmentOptions = {}): Promise<void> {
  await setFlagEnabled(slug, true, options);
}

export async function runFeatureFlagDisable(slug: string, options: FeatureFlagEnvironmentOptions = {}): Promise<void> {
  await setFlagEnabled(slug, false, options);
}

/** Targets are typed by ID prefix, mirroring the REST target endpoint's contract. */
function targetListKey(targetId: string): 'organizationIds' | 'userIds' {
  if (targetId.startsWith('user_')) return 'userIds';
  if (targetId.startsWith('org_')) return 'organizationIds';
  exitWithError({
    code: 'invalid_argument',
    message: `Invalid target ID "${targetId}". Targets must be a user (user_*) or an organization (org_*).`,
  });
}

export async function runFeatureFlagAddTarget(
  slug: string,
  targetId: string,
  options: FeatureFlagEnvironmentOptions = {},
): Promise<void> {
  const key = targetListKey(targetId);
  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });
  const projectId = await resolveProjectId(token, environmentId);
  const flag = await requireFlagBySlug(token, environmentId, projectId, slug);
  const state = requireEnvironmentState(flag, slug, environmentId);

  // The mutation replaces the lists — merge (deduped) into the current one.
  const current =
    key === 'userIds' ? (state.users ?? []).map((user) => user.id) : (state.organizations ?? []).map((org) => org.id);
  const merged = [...new Set([...current, targetId])];

  await executeFlagEnvironmentUpdate(token, environmentId, slug, state, { [key]: merged });

  if (isJsonMode()) {
    outputJson({ added: { flag: slug, targetId } });
    return;
  }
  outputSuccess(`Added target ${chalk.bold(targetId)} to feature flag ${chalk.bold(slug)}`);
}

export async function runFeatureFlagRemoveTarget(
  slug: string,
  targetId: string,
  options: FeatureFlagEnvironmentOptions = {},
): Promise<void> {
  const key = targetListKey(targetId);
  const token = await requireCommandToken();

  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: true,
  });
  const projectId = await resolveProjectId(token, environmentId);
  const flag = await requireFlagBySlug(token, environmentId, projectId, slug);
  const state = requireEnvironmentState(flag, slug, environmentId);

  const current =
    key === 'userIds' ? (state.users ?? []).map((user) => user.id) : (state.organizations ?? []).map((org) => org.id);
  if (!current.includes(targetId)) {
    exitWithError({
      code: 'not_found',
      message: `Feature flag "${slug}" has no target "${targetId}" in this environment.`,
    });
  }
  const remaining = current.filter((candidate) => candidate !== targetId);

  await executeFlagEnvironmentUpdate(token, environmentId, slug, state, { [key]: remaining });

  if (isJsonMode()) {
    outputJson({ removed: { flag: slug, targetId } });
    return;
  }
  outputSuccess(`Removed target ${chalk.bold(targetId)} from feature flag ${chalk.bold(slug)}`);
}
