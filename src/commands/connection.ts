import http from 'node:http';
import chalk from 'chalk';
import open from 'open';
import type { ConnectionType, Profile } from '@workos-inc/node';
import { createWorkOSClient } from '../lib/workos-client.js';
import { getActiveEnvironment } from '../lib/config-store.js';
import { formatTable } from '../utils/table.js';
import { outputSuccess, outputJson, isJsonMode, exitWithError } from '../utils/output.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';
import { isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import { CliExit } from '../utils/cli-exit.js';
import clack from '../utils/clack.js';

const handleApiError = createApiErrorHandler('Connection');

export interface ConnectionListOptions {
  organizationId?: string;
  connectionType?: string;
  limit?: number;
  before?: string;
  after?: string;
  order?: string;
}

export async function runConnectionList(
  options: ConnectionListOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const result = await client.sdk.sso.listConnections({
      ...(options.organizationId && { organizationId: options.organizationId }),
      ...(options.connectionType && { connectionType: options.connectionType as ConnectionType }),
      limit: options.limit,
      before: options.before,
      after: options.after,
      order: options.order as 'asc' | 'desc' | undefined,
    });

    if (isJsonMode()) {
      outputJson({ data: result.data, listMetadata: result.listMetadata });
      return;
    }

    if (result.data.length === 0) {
      console.log('No connections found.');
      return;
    }

    const rows = result.data.map((conn) => [
      conn.id,
      conn.name,
      conn.type,
      conn.organizationId || chalk.dim('-'),
      conn.state,
      conn.createdAt,
    ]);

    console.log(
      formatTable(
        [
          { header: 'ID' },
          { header: 'Name' },
          { header: 'Type' },
          { header: 'Org ID' },
          { header: 'State' },
          { header: 'Created' },
        ],
        rows,
      ),
    );

    const { before, after } = result.listMetadata;
    if (before && after) {
      console.log(chalk.dim(`Before: ${before}  After: ${after}`));
    } else if (before) {
      console.log(chalk.dim(`Before: ${before}`));
    } else if (after) {
      console.log(chalk.dim(`After: ${after}`));
    }
  } catch (error) {
    handleApiError(error);
  }
}

export async function runConnectionGet(id: string, apiKey: string, baseUrl?: string): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    const connection = await client.sdk.sso.getConnection(id);
    outputJson(connection);
  } catch (error) {
    handleApiError(error);
  }
}

export async function runConnectionDelete(
  id: string,
  options: { force?: boolean },
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  if (!options.force) {
    if (!isPromptAllowed()) {
      exitWithError({
        code: 'confirmation_required',
        message: isCiMode()
          ? 'Destructive operation requires --force flag in CI mode.'
          : 'Destructive operation requires --force flag in agent mode.',
      });
    }

    const confirmed = await clack.confirm({
      message: `Delete connection ${id}? This cannot be undone.`,
    });

    if (clack.isCancel(confirmed) || !confirmed) {
      console.log('Delete cancelled.');
      return;
    }
  }

  const client = createWorkOSClient(apiKey, baseUrl);

  try {
    await client.sdk.sso.deleteConnection(id);
    outputSuccess('Deleted connection', { id });
  } catch (error) {
    handleApiError(error);
  }
}

export interface ConnectionTestOptions {
  clientId?: string;
  port?: number;
  timeoutSeconds?: number;
  open?: boolean;
}

const DEFAULT_CALLBACK_PORT = 4807;
const DEFAULT_TEST_TIMEOUT_SECONDS = 300;

interface CallbackResult {
  code?: string;
  error?: string;
  errorDescription?: string;
  state?: string;
}

function resolveClientId(options: ConnectionTestOptions): string {
  const clientId = options.clientId || process.env.WORKOS_CLIENT_ID || getActiveEnvironment()?.clientId;
  if (!clientId) {
    exitWithError({
      code: 'no_client_id',
      message:
        'No client ID found. Pass --client-id, set WORKOS_CLIENT_ID, or run `workos env add` to configure an environment.',
    });
  }
  return clientId;
}

function waitForCallback(server: http.Server, expectedState: string, timeoutSeconds: number): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutSeconds}s waiting for the SSO callback.`));
    }, timeoutSeconds * 1000);
    timer.unref?.();

    server.on('request', (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }

      const result: CallbackResult = {
        code: url.searchParams.get('code') ?? undefined,
        error: url.searchParams.get('error') ?? undefined,
        errorDescription: url.searchParams.get('error_description') ?? undefined,
        state: url.searchParams.get('state') ?? undefined,
      };

      // Only settle when the state matches (success or IdP error — per
      // RFC 6749 §4.1.2.1 error responses echo the original state). Stray
      // requests keep the listener open.
      if (result.state !== expectedState) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Unexpected request</h2></body></html>');
        return;
      }

      const success = Boolean(result.code) && result.state === expectedState;
      res.writeHead(success ? 200 : 400, { 'Content-Type': 'text/html' });
      res.end(
        success
          ? '<html><body><h2>SSO test successful</h2><p>You can close this tab and return to the terminal.</p></body></html>'
          : '<html><body><h2>SSO test failed</h2><p>Check the terminal for details.</p></body></html>',
      );

      clearTimeout(timer);
      resolve(result);
    });
  });
}

export async function runConnectionTest(
  id: string,
  options: ConnectionTestOptions,
  apiKey: string,
  baseUrl?: string,
): Promise<void> {
  const client = createWorkOSClient(apiKey, baseUrl);
  const clientId = resolveClientId(options);
  const port = options.port ?? DEFAULT_CALLBACK_PORT;
  const timeoutSeconds = options.timeoutSeconds ?? DEFAULT_TEST_TIMEOUT_SECONDS;
  const redirectUri = `http://localhost:${port}/callback`;

  try {
    const connection = await client.sdk.sso.getConnection(id);
    if (connection.state !== 'active' && !isJsonMode()) {
      console.log(chalk.yellow(`Warning: connection is ${connection.state} (not active).`));
    }

    // Register the localhost redirect URI in the environment so the
    // authorize request passes redirect URI validation.
    let redirectUriRegistered = false;
    try {
      const result = await client.redirectUris.add(redirectUri);
      redirectUriRegistered = result.success;
      if (!isJsonMode()) {
        console.log(
          result.alreadyExists
            ? chalk.dim(`Redirect URI already registered: ${redirectUri}`)
            : chalk.green(`Registered redirect URI: ${redirectUri}`),
        );
      }
    } catch {
      if (!isPromptAllowed()) {
        exitWithError({
          code: 'redirect_uri_registration_failed',
          message: `Could not register redirect URI automatically. Add ${redirectUri} to your environment's redirect URIs in the WorkOS Dashboard, then re-run with the same --port.`,
        });
      }

      console.log(chalk.yellow(`Could not register the redirect URI automatically.`));
      console.log(`Add the following redirect URI in the WorkOS Dashboard (Redirects section):`);
      console.log(chalk.bold(`  ${redirectUri}`));
      const confirmed = await clack.confirm({ message: 'Added the redirect URI? Continue with the test?' });
      if (clack.isCancel(confirmed) || !confirmed) {
        console.log('Test cancelled.');
        return;
      }
    }

    const state = crypto.randomUUID();
    const authorizationUrl = client.sdk.sso.getAuthorizationUrl({
      clientId,
      redirectUri,
      connection: id,
      state,
    });

    const server = http.createServer();
    const callbackPromise = waitForCallback(server, state, timeoutSeconds);
    callbackPromise.catch(() => {
      // Handled when awaited below; prevents an unhandled rejection if
      // listen fails first.
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });

    try {
      if (!isJsonMode()) {
        console.log(`\nOpen the following URL to start the SSO flow:`);
        console.log(chalk.cyan(`  ${authorizationUrl}`));
        console.log(chalk.dim(`\nWaiting for callback on ${redirectUri} (timeout: ${timeoutSeconds}s)...`));
      }

      if (options.open !== false && !isCiMode()) {
        await open(authorizationUrl).catch(() => {
          // Browser may not be available; the URL is already printed.
        });
      }

      const callback = await callbackPromise;

      if (callback.error || !callback.code) {
        exitWithError({
          code: 'sso_test_failed',
          message: `SSO test failed: ${callback.error ?? 'no authorization code returned'}${
            callback.errorDescription ? ` — ${callback.errorDescription}` : ''
          }`,
        });
      }

      if (callback.state !== state) {
        exitWithError({
          code: 'state_mismatch',
          message: 'SSO test failed: state parameter mismatch in callback.',
        });
      }

      const { profile } = await client.sdk.sso.getProfileAndToken({ code: callback.code, clientId });

      if (isJsonMode()) {
        outputJson({
          connectionId: id,
          redirectUri,
          redirectUriRegistered,
          authorizationUrl,
          profile,
        });
        return;
      }

      printProfile(profile);
      console.log(chalk.green('\nSSO test succeeded.'));
    } finally {
      server.close();
    }
  } catch (error) {
    if (error instanceof CliExit) throw error;
    handleApiError(error);
  }
}

function printProfile(profile: Profile<Record<string, unknown>>): void {
  console.log(chalk.bold('\nAuthenticated profile:'));
  console.log(`  ID: ${profile.id}`);
  console.log(`  Email: ${profile.email}`);
  console.log(`  Name: ${[profile.firstName, profile.lastName].filter(Boolean).join(' ') || chalk.dim('-')}`);
  console.log(`  Connection: ${profile.connectionId} (${profile.connectionType})`);
  console.log(`  Organization: ${profile.organizationId ?? chalk.dim('-')}`);
  console.log(`  IdP ID: ${profile.idpId}`);
}
