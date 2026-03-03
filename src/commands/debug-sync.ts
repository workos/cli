import chalk from 'chalk';
import type { EventName } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Directory');

export async function runDebugSync(directoryId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    // 1. Get directory details
    const directory = await client.sdk.directorySync.getDirectory(directoryId);

    const issues: string[] = [];

    // 2. Check state
    if (String(directory.state) !== 'linked') {
      issues.push(`Directory is ${directory.state} (not linked)`);
    }

    // 3. Count users and groups
    let userCount = 0;
    let groupCount = 0;
    try {
      const users = await client.sdk.directorySync.listUsers({ directory: directoryId, limit: 1 });
      userCount = users.data.length;
      // If there's pagination, there are more
      if (users.listMetadata.after) userCount = -1; // indicates "more than 1"
    } catch {
      // May not have access
    }

    try {
      const groups = await client.sdk.directorySync.listGroups({ directory: directoryId, limit: 1 });
      groupCount = groups.data.length;
      if (groups.listMetadata.after) groupCount = -1;
    } catch {
      // May not have access
    }

    // 4. List recent sync events
    let recentEvents: Array<{ id: string; event: string; createdAt: string }> = [];
    try {
      const events = await client.sdk.events.listEvents({
        events: ['dsync.user.created', 'dsync.user.updated', 'dsync.group.created'] as EventName[],
        ...(directory.organizationId && { organizationId: directory.organizationId }),
        limit: 5,
      });
      recentEvents = events.data.map((e) => ({ id: e.id, event: e.event, createdAt: e.createdAt }));
    } catch {
      // Events may not be available
    }

    if (recentEvents.length === 0) {
      issues.push('No recent sync events found — sync may be stalled');
    }

    if (isJsonMode()) {
      outputJson({
        directory: {
          id: directory.id,
          name: directory.name,
          type: directory.type,
          state: directory.state,
          organizationId: directory.organizationId,
          createdAt: directory.createdAt,
        },
        userCount: userCount === -1 ? '1+' : userCount,
        groupCount: groupCount === -1 ? '1+' : groupCount,
        recentEvents,
        issues,
      });
      return;
    }

    // 5. Human-readable diagnosis
    console.log(chalk.bold(`Directory Sync: ${directory.name}`));
    console.log(`  ID: ${directory.id}`);
    console.log(`  Type: ${directory.type}`);
    console.log(
      `  State: ${String(directory.state) === 'linked' ? chalk.green('linked') : chalk.yellow(directory.state)}`,
    );
    console.log(`  Organization: ${directory.organizationId || chalk.dim('none')}`);
    console.log(`  Users: ${userCount === -1 ? '1+' : userCount}`);
    console.log(`  Groups: ${groupCount === -1 ? '1+' : groupCount}`);

    if (recentEvents.length > 0) {
      console.log(chalk.bold('\nRecent sync events:'));
      for (const event of recentEvents) {
        console.log(`  ${event.event} (${event.createdAt})`);
      }
    } else {
      console.log(chalk.dim('\nNo recent sync events found.'));
    }

    if (issues.length > 0) {
      console.log(chalk.bold('\nIssues found:'));
      for (const issue of issues) {
        console.log(chalk.yellow(`  ⚠ ${issue}`));
      }
    } else {
      console.log(chalk.green('\nNo issues detected.'));
    }
  } catch (error) {
    handleApiError(error);
  }
}
