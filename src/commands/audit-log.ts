import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import type { CreateAuditLogEventOptions } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { formatTable } from '../utils/table.js';
import { outputJson, outputSuccess, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('AuditLog');

// ── create-event ──────────────────────────────────────────────────────

export interface AuditLogCreateEventFlags {
  action?: string;
  actorType?: string;
  actorId?: string;
  actorName?: string;
  targets?: string;
  context?: string;
  metadata?: string;
  occurredAt?: string;
  file?: string;
}

export async function runAuditLogCreateEvent(
  orgId: string,
  flags: AuditLogCreateEventFlags,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    let event: CreateAuditLogEventOptions;

    if (flags.file) {
      const raw = await readFile(flags.file, 'utf-8');
      event = JSON.parse(raw);
    } else {
      if (!flags.action || !flags.actorType || !flags.actorId) {
        throw new Error('--action, --actor-type, and --actor-id are required (or use --file)');
      }
      event = {
        action: flags.action,
        occurredAt: flags.occurredAt ? new Date(flags.occurredAt) : new Date(),
        actor: {
          id: flags.actorId,
          type: flags.actorType,
          ...(flags.actorName && { name: flags.actorName }),
        },
        targets: flags.targets ? JSON.parse(flags.targets) : [],
        context: flags.context ? JSON.parse(flags.context) : { location: '0.0.0.0' },
        ...(flags.metadata && { metadata: JSON.parse(flags.metadata) }),
      };
    }

    await client.sdk.auditLogs.createEvent(orgId, event);
    outputSuccess('Created audit log event', { organization_id: orgId, action: event.action });
  } catch (error) {
    handleApiError(error);
  }
}

// ── export ────────────────────────────────────────────────────────────

export interface AuditLogExportOptions {
  organizationId: string;
  rangeStart: string;
  rangeEnd: string;
  actions?: string[];
  actorNames?: string[];
  actorIds?: string[];
  targets?: string[];
}

const POLL_MAX_ATTEMPTS = 60;
const POLL_INITIAL_DELAY_MS = 1000;
const POLL_MAX_DELAY_MS = 30000;

export async function runAuditLogExport(
  options: AuditLogExportOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const exportResult = await client.sdk.auditLogs.createExport({
      organizationId: options.organizationId,
      rangeStart: new Date(options.rangeStart),
      rangeEnd: new Date(options.rangeEnd),
      ...(options.actions && { actions: options.actions }),
      ...(options.actorNames && { actorNames: options.actorNames }),
      ...(options.actorIds && { actorIds: options.actorIds }),
      ...(options.targets && { targets: options.targets }),
    });

    let current = exportResult;
    let delay = POLL_INITIAL_DELAY_MS;

    for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS && current.state === 'pending'; attempt++) {
      if (!isJsonMode()) {
        process.stderr.write('.');
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, POLL_MAX_DELAY_MS);
      current = await client.sdk.auditLogs.getExport(current.id);
    }

    if (!isJsonMode() && current.state !== 'pending') {
      process.stderr.write('\n');
    }

    if (current.state === 'error') {
      throw new Error(`Export failed (id: ${current.id})`);
    }

    if (current.state === 'pending') {
      throw new Error(`Export timed out (id: ${current.id}). Check status later.`);
    }

    if (isJsonMode()) {
      outputJson(current);
      return;
    }

    console.log(chalk.green('Export ready'));
    console.log(`  ID:  ${current.id}`);
    if (current.url) {
      console.log(`  URL: ${current.url}`);
    }
  } catch (error) {
    handleApiError(error);
  }
}

// ── list-actions ──────────────────────────────────────────────────────

export async function runAuditLogListActions(apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.auditLogs.listActions();

    if (isJsonMode()) {
      outputJson(result);
      return;
    }

    if (result.data.length === 0) {
      console.log('No audit log actions found.');
      return;
    }

    const rows = result.data.map((item) => [item.action]);
    console.log(formatTable([{ header: 'Action Name' }], rows));
  } catch (error) {
    handleApiError(error);
  }
}

// ── get-schema ────────────────────────────────────────────────────────

export async function runAuditLogGetSchema(action: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.auditLogs.getSchema(action);

    if (isJsonMode()) {
      outputJson(result);
      return;
    }

    console.log(chalk.bold(`Schema for ${action}`));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    handleApiError(error);
  }
}

// ── create-schema ─────────────────────────────────────────────────────

export async function runAuditLogCreateSchema(
  action: string,
  filePath: string,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const raw = await readFile(filePath, 'utf-8');
    const schema = JSON.parse(raw);

    const result = await client.sdk.auditLogs.createSchema({
      action,
      ...schema,
    });

    outputSuccess('Created audit log schema', result);
  } catch (error) {
    handleApiError(error);
  }
}

// ── get-retention ─────────────────────────────────────────────────────

export async function runAuditLogGetRetention(orgId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.auditLogs.getRetention(orgId);

    if (isJsonMode()) {
      outputJson(result);
      return;
    }

    console.log(`Retention period: ${chalk.bold(String(result.retention_period_in_days))} days`);
  } catch (error) {
    handleApiError(error);
  }
}
