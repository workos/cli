/**
 * `workos vault run` fetches secrets from WorkOS Vault and injects them as
 * environment variables into a child process. Secret values never appear
 * in this wrapper's stdout/stderr; error messages reference vault object
 * names only.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';
import { isJsonMode, outputJson, outputSuccess, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';
import { SPAWN_OPTS, IS_WINDOWS } from '../utils/platform.js';

const handleApiError = createApiErrorHandler('Vault');

/**
 * Duck-type check for `@workos-inc/node` SDK exceptions, which carry a
 * numeric `status` and a `requestID`. Mirrors the check in `api-error-handler`,
 * inlined here so we can react to status codes before the generic handler
 * substitutes its own messages.
 */
function isSdkLikeException(error: unknown): error is { status: number; message: string; requestID: string } {
  if (!(error instanceof Error)) return false;
  const e = error as Error & { status?: unknown; requestID?: unknown };
  return typeof e.status === 'number' && typeof e.requestID === 'string';
}

export interface SecretMapping {
  envVar: string;
  vaultName: string;
}

export interface VaultRunOptions {
  secrets: string[];
  command: string[];
  env?: string;
  org?: string;
  dryRun?: boolean;
}

/**
 * Parse `--secret ENV_VAR=vault-name` flags into structured mappings.
 *
 * Splits on the first `=` so vault names containing `=` are not supported
 * (env var names cannot contain `=` either, so the first split is unambiguous).
 * Throws with a clear error on invalid format or duplicate env var names.
 */
export function parseSecretMappings(secrets: string[]): SecretMapping[] {
  if (!secrets || secrets.length === 0) {
    exitWithError({
      code: 'missing_secrets',
      message: 'At least one --secret ENV=name mapping is required',
    });
  }

  const result: SecretMapping[] = [];
  const seen = new Set<string>();

  for (const raw of secrets) {
    const eqIndex = raw.indexOf('=');
    if (eqIndex <= 0 || eqIndex === raw.length - 1) {
      exitWithError({
        code: 'invalid_secret_format',
        message: `Invalid secret mapping '${raw}'. Expected format: ENV_VAR=vault-name`,
      });
    }

    const envVar = raw.slice(0, eqIndex);
    const vaultName = raw.slice(eqIndex + 1);

    if (!envVar || !vaultName) {
      exitWithError({
        code: 'invalid_secret_format',
        message: `Invalid secret mapping '${raw}'. Expected format: ENV_VAR=vault-name`,
      });
    }

    if (seen.has(envVar)) {
      exitWithError({
        code: 'duplicate_env_var',
        message: `Duplicate environment variable '${envVar}' in --secret mappings`,
      });
    }
    seen.add(envVar);

    result.push({ envVar, vaultName });
  }

  return result;
}

/**
 * Fetch each secret from Vault, sequentially. Stops on the first failure
 * so a partial set of values is never injected into the child process.
 *
 * Error messages include the vault object name, never the value.
 */
export async function fetchSecrets(
  mappings: SecretMapping[],
  apiKey: string,
  baseUrl?: string,
): Promise<Map<string, string>> {
  const client = createWorkOSClient(apiKey, baseUrl);
  const values = new Map<string, string>();

  for (const { envVar, vaultName } of mappings) {
    try {
      const obj = await client.sdk.vault.readObjectByName(vaultName);
      if (typeof obj.value !== 'string') {
        exitWithError({
          code: 'vault_value_missing',
          message: `Vault object '${vaultName}' has no readable value`,
        });
      }
      values.set(envVar, obj.value);
    } catch (error) {
      // The error path must always reference the vault object name, never
      // the value. For SDK exceptions we handle 404/401 explicitly so the
      // message includes the name; for everything else we wrap and delegate
      // to the shared API error handler.
      if (isSdkLikeException(error)) {
        const status = error.status;
        if (status === 404) {
          exitWithError({
            code: 'vault_object_not_found',
            message: `Vault object '${vaultName}' not found`,
          });
        }
        if (status === 401) {
          exitWithError({
            code: 'unauthorized',
            message: "Invalid API key. Check your environment configuration with 'workos auth status'",
          });
        }
        exitWithError({
          code: `http_${status}`,
          message: `Failed to fetch vault object '${vaultName}': ${error.message ?? 'request failed'}`,
        });
      }
      if (error instanceof Error) {
        exitWithError({
          code: 'vault_fetch_failed',
          message: `Failed to fetch vault object '${vaultName}': ${error.message}`,
        });
      }
      // Fallback: never expose the value via raw error.
      handleApiError(error);
    }
  }

  return values;
}

/**
 * Resolve the API key to use for this invocation.
 *
 * If `--env` is provided, look up that environment's stored API key.
 * Otherwise fall back to the standard resolution chain
 * (--api-key flag > WORKOS_API_KEY env var > active environment).
 */
async function resolveRunApiKey(envName: string | undefined, flagApiKey?: string): Promise<string> {
  if (!envName) {
    const { resolveApiKey } = await import('../lib/api-key.js');
    return resolveApiKey({ apiKey: flagApiKey });
  }

  const { getConfig } = await import('../lib/config-store.js');
  const config = getConfig();
  const env = config?.environments[envName];
  if (!env || !env.apiKey) {
    exitWithError({
      code: 'env_not_found',
      message: `Environment '${envName}' not found or has no API key. Run 'workos env list' to see available environments.`,
    });
  }
  return env.apiKey;
}

/**
 * Print dry-run metadata (env var -> vault object name mapping).
 * Never prints secret values; only the names of the targeted vault objects.
 */
function printDryRun(mappings: SecretMapping[], envName?: string, org?: string): void {
  if (isJsonMode()) {
    outputJson({
      dryRun: true,
      env: envName ?? null,
      org: org ?? null,
      mappings: mappings.map(({ envVar, vaultName }) => ({ envVar, vaultName })),
    });
    return;
  }

  console.log(chalk.dim('Dry run (no secrets will be fetched and no child process will be spawned).'));
  if (envName) console.log(chalk.dim(`Environment: ${envName}`));
  if (org) console.log(chalk.dim(`Organization: ${org}`));
  console.log();
  const rows = mappings.map(({ envVar, vaultName }) => [envVar, vaultName]);
  console.log(formatTable([{ header: 'Environment Variable' }, { header: 'Vault Object' }], rows));
}

/**
 * Spawn the child process with the injected environment.
 * Forwards SIGINT/SIGTERM (and SIGBREAK on Windows) to the child and exits
 * with the child's exit code so the wrapper is transparent in shell pipelines.
 */
function spawnChild(command: string, args: string[], childEnv: NodeJS.ProcessEnv): never {
  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      stdio: 'inherit',
      env: childEnv,
      ...SPAWN_OPTS,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    exitWithError({
      code: 'spawn_failed',
      message: `Failed to start: ${command}: ${message}`,
    });
  }

  child.on('error', (err) => {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      exitWithError({
        code: 'command_not_found',
        message: `Command not found: ${command}`,
      });
    }
    exitWithError({
      code: 'spawn_error',
      message: `Failed to start: ${command}: ${err.message}`,
    });
  });

  // Forward signals to the child so Ctrl+C, kill, etc. stop the wrapped process.
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  if (IS_WINDOWS) {
    process.on('SIGBREAK', () => forward('SIGINT'));
  }

  child.on('exit', (code, signal) => {
    if (signal) {
      // Mirror the shell convention: 128 + signal number, fall back to 1.
      const num = typeof signal === 'string' ? signalToNumber(signal) : 0;
      process.exit(num ? 128 + num : 1);
    }
    process.exit(code ?? 0);
  });

  // Keep TypeScript happy: the handlers above always terminate the process.
  return undefined as never;
}

function signalToNumber(signal: NodeJS.Signals): number {
  const map: Record<string, number> = {
    SIGHUP: 1,
    SIGINT: 2,
    SIGQUIT: 3,
    SIGKILL: 9,
    SIGTERM: 15,
  };
  return map[signal] ?? 0;
}

/**
 * Entry point for `workos vault run`.
 *
 * 1. Validate inputs (secrets, child command).
 * 2. On --dry-run: print metadata and return without fetching.
 * 3. Resolve API key (per --env or active environment).
 * 4. Fetch all secrets sequentially (fail fast).
 * 5. Spawn the child with `{ ...process.env, ...injected }`.
 */
export async function runVaultRun(options: VaultRunOptions, flagApiKey?: string, baseUrl?: string): Promise<void> {
  const mappings = parseSecretMappings(options.secrets);

  if (options.dryRun) {
    printDryRun(mappings, options.env, options.org);
    return;
  }

  if (!options.command || options.command.length === 0) {
    exitWithError({
      code: 'missing_command',
      message: 'No command specified. Usage: workos vault run --secret ENV=name -- command',
    });
  }

  const apiKey = await resolveRunApiKey(options.env, flagApiKey);
  const secretValues = await fetchSecrets(mappings, apiKey, baseUrl);

  // JSON mode: emit metadata about what was injected (no values) before exec.
  if (isJsonMode()) {
    outputSuccess('Injected secrets into child process', {
      env: options.env ?? null,
      org: options.org ?? null,
      injected: mappings.map(({ envVar, vaultName }) => ({ envVar, vaultName })),
    });
  }

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [envVar, value] of secretValues) {
    childEnv[envVar] = value;
  }

  const [cmd, ...args] = options.command;
  spawnChild(cmd, args, childEnv);
}
