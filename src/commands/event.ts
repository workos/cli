/**
 * `workos event` — environment event log on the dashboard account plane.
 *
 * Migrated from the API-key REST SDK (graphql-resource-migration Phase 6): the
 * subcommand surface (`list`) is unchanged, but the listing now runs the
 * catalog-backed environment-events operation with the user's OAuth bearer.
 * Output shapes are new curated shapes (approved breaking change); the
 * authoritative examples live in `event.spec.ts`.
 *
 * Backend divergences from REST (all loud, none faked):
 * - `--org` was DROPPED: the backing operation's vendored document declares no
 *   organization variable. (The upstream schema accepts one, so a future
 *   snapshot re-vendor can restore the flag.)
 * - `--events` stays required (frozen grammar) even though the backing filter
 *   is optional server-side.
 * - The listing keeps the single-page default. GraphQL returns events
 *   newest-first and names its forward (older-page) cursor `before`; the CLI
 *   keeps REST's `--after` grammar and maps that cursor in both directions so
 *   `--after` still means "next page" to a caller.
 */

import chalk from 'chalk';
import { runEnvScopedOperation } from '../lib/dashboard-operation.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { printPaginationFooter } from '../utils/resource-command.js';
import { formatTable } from '../utils/table.js';

interface EventNode {
  id: string;
  name?: string | null;
  data?: unknown;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/**
 * The curated event shape — the `--json` contract. camelCase, stable keys, no
 * internal fields (the wire rows also carry request context/metadata, which
 * REST never exposed and the curated shape drops); see event.spec.ts for the
 * authoritative example.
 */
function shapeEvent(event: EventNode) {
  return {
    id: event.id,
    event: event.name ?? null,
    data: event.data ?? null,
    createdAt: event.createdAt ?? null,
    updatedAt: event.updatedAt ?? null,
  };
}

export interface EventListOptions {
  /** `--environment-id` override; defaults from the active profile. */
  environmentId?: string;
  /** `--events` comma-separated event types (required by the frozen grammar). */
  events: string[];
  after?: string;
  rangeStart?: string;
  rangeEnd?: string;
  limit?: number;
}

export async function runEventList(options: EventListOptions): Promise<void> {
  const { data, environmentId } = await runEnvScopedOperation<{
    environment: {
      events: {
        data: EventNode[];
        listMetadata: { before: string | null; after: string | null };
      } | null;
    } | null;
  }>('environmentEvents', options, (environmentId) => ({
    environmentId,
    names: options.events,
    // The GraphQL connection is newest-first. Its `before` cursor advances to
    // older rows, which is the CLI's next page and therefore the cursor exposed
    // as `after` in the public contract inherited from REST.
    ...(options.after ? { before: options.after } : {}),
    ...(options.rangeStart ? { rangeStart: options.rangeStart } : {}),
    ...(options.rangeEnd ? { rangeEnd: options.rangeEnd } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  }));

  if (!data.environment) {
    exitWithError({ code: 'environment_not_found', message: `Environment "${environmentId}" was not found.` });
  }

  const events = (data.environment.events?.data ?? []).map(shapeEvent);
  const pagination = {
    // Swap the wire names so callers can continue feeding the returned `after`
    // cursor back through `--after` to reach the next page. Exposing the raw
    // GraphQL names made page one return only `before`, a flag the CLI does not
    // accept, so older pages were unreachable.
    before: data.environment.events?.listMetadata?.after ?? null,
    after: data.environment.events?.listMetadata?.before ?? null,
  };

  if (isJsonMode()) {
    outputJson({ events, pagination });
    return;
  }

  if (events.length === 0) {
    console.log('No events found.');
    return;
  }

  const rows = events.map((event) => [event.id, event.event ?? chalk.dim('-'), event.createdAt ?? chalk.dim('-')]);
  console.log(formatTable([{ header: 'ID' }, { header: 'Event Type' }, { header: 'Created At' }], rows));

  printPaginationFooter(pagination);
}
