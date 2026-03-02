import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { outputJson, isJsonMode } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';

const handleApiError = createApiErrorHandler('OnboardUser');

export interface OnboardUserOptions {
  email: string;
  org: string;
  role?: string;
  wait?: boolean;
}

export async function runOnboardUser(options: OnboardUserOptions, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);
  const summary: Record<string, unknown> = {};

  try {
    if (!isJsonMode()) console.log(chalk.bold(`Onboarding user: ${options.email}`));

    // 1. Send invitation
    const invitation = await client.sdk.userManagement.sendInvitation({
      email: options.email,
      organizationId: options.org,
      ...(options.role && { roleSlug: options.role }),
    });
    summary.invitationId = invitation.id;
    if (!isJsonMode()) console.log(chalk.green(`  Sent invitation: ${invitation.id}`));

    // 2. Optional: wait for acceptance
    if (options.wait) {
      if (!isJsonMode()) console.log(chalk.dim('  Waiting for invitation acceptance...'));

      const maxAttempts = 60;
      const pollInterval = 5000;

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
        const status = await client.sdk.userManagement.getInvitation(invitation.id);

        if (status.state === 'accepted') {
          summary.invitationAccepted = true;
          if (!isJsonMode()) console.log(chalk.green('  Invitation accepted!'));
          break;
        }

        if (status.state === 'revoked' || status.state === 'expired') {
          summary.invitationAccepted = false;
          if (!isJsonMode()) console.log(chalk.yellow(`  Invitation ${status.state}.`));
          break;
        }

        if (!isJsonMode() && i % 6 === 0) console.log(chalk.dim(`  Still waiting... (${status.state})`));
      }
    }

    // 3. Print summary
    if (isJsonMode()) {
      outputJson({ status: 'ok', ...summary });
    } else {
      console.log(chalk.bold('\nOnboarding summary:'));
      console.log(`  Invitation: ${invitation.id} (${invitation.state})`);
      if (options.role) console.log(`  Role: ${options.role}`);
    }
  } catch (error) {
    handleApiError(error);
  }
}
