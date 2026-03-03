import chalk from 'chalk';
import type { EventName } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('Connection');

export async function runDebugSso(connectionId: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    // 1. Get connection details
    const connection = await client.sdk.sso.getConnection(connectionId);

    const issues: string[] = [];

    // 2. Check for common issues
    if (connection.state !== 'active') {
      issues.push(`Connection is ${connection.state} (not active)`);
    }

    // 3. List recent authentication events
    let recentEvents: Array<{ id: string; event: string; createdAt: string }> = [];
    try {
      const events = await client.sdk.events.listEvents({
        events: [
          'authentication.email_verification_succeeded',
          'authentication.magic_auth_succeeded',
          'authentication.sso_succeeded',
        ] as EventName[],
        ...(connection.organizationId && { organizationId: connection.organizationId }),
        limit: 5,
      });
      recentEvents = events.data.map((e) => ({ id: e.id, event: e.event, createdAt: e.createdAt }));
    } catch {
      // Events may not be available
    }

    if (isJsonMode()) {
      outputJson({
        connection: {
          id: connection.id,
          name: connection.name,
          type: connection.type,
          state: connection.state,
          organizationId: connection.organizationId,
          createdAt: connection.createdAt,
        },
        recentEvents,
        issues,
      });
      return;
    }

    // 4. Human-readable diagnosis
    console.log(chalk.bold(`SSO Connection: ${connection.name}`));
    console.log(`  ID: ${connection.id}`);
    console.log(`  Type: ${connection.type}`);
    console.log(`  State: ${connection.state === 'active' ? chalk.green('active') : chalk.yellow(connection.state)}`);
    console.log(`  Organization: ${connection.organizationId || chalk.dim('none')}`);
    console.log(`  Created: ${connection.createdAt}`);

    if (recentEvents.length > 0) {
      console.log(chalk.bold('\nRecent auth events:'));
      for (const event of recentEvents) {
        console.log(`  ${event.event} (${event.createdAt})`);
      }
    } else {
      console.log(chalk.dim('\nNo recent authentication events found.'));
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
