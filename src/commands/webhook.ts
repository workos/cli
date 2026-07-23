/**
 * `workos webhook` — webhook-endpoint lifecycle on the dashboard account plane.
 *
 * Migrated from the API-key REST plane (graphql-resource-migration Phase 7):
 * the subcommand surface (list/create/delete) is unchanged, but every operation
 * now runs catalog-backed dashboard operations with the user's OAuth bearer.
 * Output shapes are new curated shapes (approved breaking change); the
 * authoritative examples live in `webhook.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `create` no longer returns the signing secret: the backing operation
 *   returns only the new endpoint's ID (REST returned the secret once, at
 *   create time). Human output says where to find it; help text says so too.
 *
 * Safety posture per the manifest: `delete` is destructive →
 * `confirmDestructive` (prompt, or --yes). The consequence copy is hand-written
 * (the operation carries no catalog confirmation phrase).
 */

import chalk from 'chalk';
import { requireCommandToken } from '../lib/command-auth.js';
import { dashboardGraphqlRequest } from '../lib/dashboard-graphql.js';
import { resolveEnvironmentTarget } from '../lib/environment-target.js';
import { getOperation, resolveExecutableDocument, reportDashboardError } from '../catalog/operation.js';
import { confirmDestructive } from '../catalog/confirm.js';
import { isJsonMode, outputJson, outputSuccess } from '../utils/output.js';
import { formatTable } from '../utils/table.js';

interface WebhookEndpointNode {
  id?: string | null;
  endpointUrl?: string | null;
  events?: string[] | null;
  state?: string | null;
  createdAt?: string | null;
}

/**
 * The curated webhook-endpoint shape — the `--json` contract. camelCase,
 * stable keys, no internal fields. See webhook.spec.ts for the authoritative
 * example.
 */
function shapeWebhookEndpoint(endpoint: WebhookEndpointNode) {
  return {
    id: endpoint.id ?? null,
    url: endpoint.endpointUrl ?? null,
    events: endpoint.events ?? [],
    state: endpoint.state ?? null,
    createdAt: endpoint.createdAt ?? null,
  };
}

type ShapedWebhookEndpoint = ReturnType<typeof shapeWebhookEndpoint>;

/**
 * Truncate an endpoint's event list to a table-cell budget, always keeping at
 * least the first event so the cell isn't content-free.
 */
function formatEventsCell(events: string[]): string {
  const maxEventsChars = 60;
  if (events.length === 0) return chalk.dim('—');
  const joined = events.join(', ');
  if (joined.length <= maxEventsChars) return joined;
  const visible: string[] = [events[0]];
  let len = events[0].length;
  for (let i = 1; i < events.length; i++) {
    const next = len + 2 + events[i].length;
    if (next > maxEventsChars) break;
    visible.push(events[i]);
    len = next;
  }
  const hidden = events.length - visible.length;
  const suffix = hidden > 0 ? `, … (+${hidden} more)` : '';
  return `${visible.join(', ')}${suffix}`;
}

export interface WebhookListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
}

export async function runWebhookList(options: WebhookListOptions = {}): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('webhookEndpoints');

  // Environment-scoped read: resolved target as variable + header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  let data: {
    webhookEndpoints: {
      data: WebhookEndpointNode[];
      listMetadata?: { before?: string | null; after?: string | null } | null;
    } | null;
  };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { environmentId },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  const endpoints = (data.webhookEndpoints?.data ?? []).map(shapeWebhookEndpoint);
  const pagination = {
    before: data.webhookEndpoints?.listMetadata?.before ?? null,
    after: data.webhookEndpoints?.listMetadata?.after ?? null,
  };

  if (isJsonMode()) {
    outputJson({ webhookEndpoints: endpoints, pagination });
    return;
  }

  if (endpoints.length === 0) {
    console.log('No webhook endpoints found.');
    return;
  }

  const rows = endpoints.map((endpoint: ShapedWebhookEndpoint) => [
    endpoint.id ?? '',
    endpoint.url ?? '',
    formatEventsCell(endpoint.events),
    endpoint.state ?? '',
    endpoint.createdAt ?? '',
  ]);
  console.log(
    formatTable(
      [{ header: 'ID' }, { header: 'URL' }, { header: 'Events' }, { header: 'State' }, { header: 'Created' }],
      rows,
    ),
  );

  const { before, after } = pagination;
  if (before && after) {
    console.log(chalk.dim(`Before: ${before}  After: ${after}`));
  } else if (before) {
    console.log(chalk.dim(`Before: ${before}`));
  } else if (after) {
    console.log(chalk.dim(`After: ${after}`));
  }
}

export interface WebhookCreateOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  url: string;
  events: string[];
}

export async function runWebhookCreate(options: WebhookCreateOptions): Promise<void> {
  const token = await requireCommandToken();
  const op = getOperation('createWebhookEndpoint');

  // Environment-scoped mutation: pre-validated resolved target as variable +
  // header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  // No result union: validation failures (e.g. a non-HTTPS endpoint URL)
  // surface as wire-level errors via reportDashboardError.
  let data: { createWebhookEndpoint: { id: string } | null };
  try {
    data = await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { endpointUrl: options.url, environmentId, events: options.events },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  // The backing operation returns only the new endpoint's ID; echo the inputs
  // so the output is self-describing.
  const created = { id: data.createWebhookEndpoint?.id ?? null, url: options.url, events: options.events };
  if (isJsonMode()) {
    outputJson({ webhookEndpoint: created });
    return;
  }
  outputSuccess(`Created webhook endpoint ${chalk.bold(created.id ?? options.url)}`);
  // Divergence from REST (loud): the signing secret is no longer returned at
  // create time.
  console.log(chalk.dim('The signing secret is not shown here — view it in the WorkOS Dashboard under Webhooks.'));
}

export interface WebhookDeleteOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  yes?: boolean;
  json?: boolean;
}

export async function runWebhookDelete(id: string, options: WebhookDeleteOptions = {}): Promise<void> {
  // Destructive per the manifest: the operation carries no catalog confirmation
  // phrase, so the consequence copy is hand-written.
  await confirmDestructive(options, {
    action: `delete webhook endpoint ${id} — it stops receiving events immediately`,
  });

  const token = await requireCommandToken();
  const op = getOperation('deleteWebhookEndpoint');

  // Environment-scoped mutation: pre-validated resolved target as header.
  const { environmentId } = await resolveEnvironmentTarget(token, {
    flagValue: options.environmentId,
    forMutation: op.kind === 'mutation',
  });

  // No result union: a bad ID surfaces as a wire-level error via
  // reportDashboardError.
  try {
    await dashboardGraphqlRequest(resolveExecutableDocument(op), {
      token,
      variables: { id },
      environmentId,
    });
  } catch (error) {
    reportDashboardError(error);
  }

  if (isJsonMode()) {
    outputJson({ deleted: id });
    return;
  }
  outputSuccess(`Deleted webhook endpoint ${chalk.bold(id)}`);
}
