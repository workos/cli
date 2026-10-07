import { UnauthorizedException } from '@workos-inc/node';
import { DashboardGraphqlError } from './dashboard-graphql.js';
import { WorkOSApiError } from './workos-api.js';
import ui from '../utils/ui.js';
import { isPromptAllowed } from '../utils/interaction-mode.js';
import { isJsonMode } from '../utils/output.js';
import { CliExit } from '../utils/cli-exit.js';
import { ExitCode } from '../utils/exit-codes.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';

/** Preserve HTTP status without exposing backend response bodies (which may contain secrets). */
export class DashboardConfigError extends Error {
  constructor(readonly status: number) {
    super(`WorkOS configuration request failed (HTTP ${status}).`);
    this.name = 'DashboardConfigError';
  }
}

export function isConfigurationUnauthorized(error: unknown): boolean {
  return (
    ((error instanceof DashboardConfigError || error instanceof DashboardGraphqlError) && error.status === 401) ||
    (error instanceof WorkOSApiError && error.statusCode === 401) ||
    error instanceof UnauthorizedException
  );
}

export interface ConfigurationCredentials {
  apiKey: string;
  clientId: string;
}

export function configurationRecoveryHint(): string {
  return `Run \`${formatWorkOSCommand('auth login')}\` to check dashboard access, then retry setup for the same application, or configure its URLs manually in the WorkOS dashboard. A dashboard login does not itself replace a rejected API key.`;
}

type RecoveryResult =
  | { token: string; credentials?: ConfigurationCredentials }
  | { reason: string; code?: 'cancelled' };

/** One offer, not a retry loop. Callers own the single retry and target/read-back checks. */
export async function recoverConfigurationAccess(
  rejected: { token: string } | { apiKey: string; clientId?: string },
  interactive = true,
): Promise<RecoveryResult> {
  const hint = configurationRecoveryHint();
  if (!interactive || !isPromptAllowed() || isJsonMode() || !process.stdin.isTTY) {
    return { reason: `Unauthorized. Interactive recovery is unavailable. ${hint}` };
  }
  const choice = await ui.select({
    message: 'WorkOS returned Unauthorized. How would you like to proceed?',
    options: [
      {
        value: 'retry',
        label: 'Check authentication and retry once',
        hint: 'Keep the same application; sign in only if needed',
      },
      { value: 'manual', label: 'Configure manually', hint: 'Leave credentials unchanged' },
    ],
  });
  if (ui.isCancel(choice)) return { reason: `Unauthorized recovery cancelled. ${hint}`, code: 'cancelled' };
  if (choice !== 'retry') return { reason: `Unauthorized recovery declined; manual configuration selected. ${hint}` };

  try {
    const { ensureAuthenticated } = await import('./ensure-auth.js');
    const auth = await ensureAuthenticated();
    if (!auth.authenticated) return { reason: `Authentication check failed. ${hint}` };
    ui.log.info(
      auth.loginTriggered
        ? 'Signed in to WorkOS.'
        : auth.tokenRefreshed
          ? 'Dashboard session refreshed.'
          : 'Using the existing dashboard session; no new login was needed.',
    );
    const { getAccessToken } = await import('./credentials.js');
    const token = getAccessToken();
    if (!token) return { reason: `No usable dashboard session. ${hint}` };
    if ('token' in rejected) {
      return token === rejected.token
        ? { reason: `The dashboard session is unchanged; the rejected session was not retried. ${hint}` }
        : { token };
    }
    if (!rejected.clientId)
      return { reason: `Cannot verify replacement credentials without the intended client ID. ${hint}` };
    const { fetchStagingCredentials } = await import('./staging-api.js');
    const credentials = await fetchStagingCredentials(token);
    // This endpoint returns an authoritative pair. Never adopt a different target,
    // a pasted key, a production key, or the same rejected key. Do not save a profile.
    if (
      credentials.clientId !== rejected.clientId ||
      !credentials.apiKey.startsWith('sk_test_') ||
      /[\r\n]/.test(credentials.apiKey)
    ) {
      return {
        reason: `No replacement sandbox credentials verified for this application. Application credentials were left unchanged. ${hint}`,
      };
    }
    if (credentials.apiKey === rejected.apiKey) {
      return { reason: `The API key is unchanged; the rejected key was not retried. ${hint}` };
    }
    return { token, credentials };
  } catch (error) {
    if (error instanceof CliExit && error.exitCode === ExitCode.CANCELLED) {
      return { reason: `Unauthorized recovery cancelled. ${hint}`, code: 'cancelled' };
    }
    return { reason: `Authentication recovery failed. Application credentials were left unchanged. ${hint}` };
  }
}
