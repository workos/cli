import { spawn, type ChildProcess } from 'node:child_process';
import chalk from 'chalk';
import { createWorkOSClient } from '../lib/workos-client.js';
import { createApiErrorHandler } from '../lib/api-error-handler.js';
import { isJsonMode, outputJson, exitWithError } from '../utils/output.js';
import { formatTable } from '../utils/table.js';
import { SPAWN_OPTS, IS_WINDOWS } from '../utils/platform.js';

const handleApiError = createApiErrorHandler('Vault');

export interface SecretMapping {
  envVar: string;
  vaultName: string;
}

export interface VaultRunOptions {
  secrets: string[];
  command: string[];
  env?: string;
  dryRun?: boolean;
}

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

export async function fetchSecrets(
  mappings: SecretMapping[],
  apiKey: string,
  baseUrl?: string,
): Promise<Map<string, string>> {
  const client = createWorkOSClient(apiKey, baseUrl);

  const entries = await Promise.all(
    mappings.map(async ({ envVar, vaultName }): Promise<[string, string]> => {
      let obj: { value?: unknown };
      try {
        obj = await client.sdk.vault.readObjectByName(vaultName);
      } catch (error) {
        return handleApiError(error, vaultName);
      }
      if (typeof obj.value !== 'string') {
        exitWithError({
          code: 'vault_value_missing',
          message: `Vault object '${vaultName}' has no readable value`,
        });
      }
      return [envVar, obj.value];
    }),
  );

  return new Map(entries);
}

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

async function resolveRunBaseUrl(envName: string | undefined): Promise<string> {
  if (envName) {
    const { getConfig } = await import('../lib/config-store.js');
    const config = getConfig();
    const env = config?.environments[envName];
    // Use the named env's endpoint, or the default. Never fall through to
    // the active env's endpoint -- that would send the wrong API key to
    // the wrong host when active != selected.
    return env?.endpoint ?? 'https://api.workos.com';
  }
  const { resolveApiBaseUrl } = await import('../lib/api-key.js');
  return resolveApiBaseUrl();
}

function printDryRun(mappings: SecretMapping[], envName?: string): void {
  if (isJsonMode()) {
    outputJson({
      dryRun: true,
      env: envName ?? null,
      mappings: mappings.map(({ envVar, vaultName }) => ({ envVar, vaultName })),
    });
    return;
  }

  console.log(chalk.dim('Dry run (no secrets will be fetched and no child process will be spawned).'));
  if (envName) console.log(chalk.dim(`Environment: ${envName}`));
  console.log();
  const rows = mappings.map(({ envVar, vaultName }) => [envVar, vaultName]);
  console.log(formatTable([{ header: 'Environment Variable' }, { header: 'Vault Object' }], rows));
}

function spawnChild(command: string, args: string[], childEnv: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
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
      try {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          exitWithError({ code: 'command_not_found', message: `Command not found: ${command}` });
        }
        exitWithError({ code: 'spawn_error', message: `Failed to start: ${command}: ${err.message}` });
      } catch (e) {
        reject(e);
      }
    });

    const forward = (signal: NodeJS.Signals) => {
      if (!child.killed) child.kill(signal);
    };
    process.once('SIGINT', () => forward('SIGINT'));
    process.once('SIGTERM', () => forward('SIGTERM'));
    if (IS_WINDOWS) {
      process.once('SIGBREAK', () => forward('SIGINT'));
    }

    child.on('exit', (code, signal) => {
      if (signal) {
        const num = signalToNumber(signal);
        resolve(num ? 128 + num : 1);
      } else {
        resolve(code ?? 0);
      }
    });
  });
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

export async function runVaultRun(options: VaultRunOptions, flagApiKey?: string): Promise<number | void> {
  const mappings = parseSecretMappings(options.secrets);

  if (options.dryRun) {
    printDryRun(mappings, options.env);
    return;
  }

  if (!options.command || options.command.length === 0) {
    exitWithError({
      code: 'missing_command',
      message: 'No command specified. Usage: workos vault run --secret ENV=name -- command',
    });
  }

  const apiKey = await resolveRunApiKey(options.env, flagApiKey);
  const baseUrl = await resolveRunBaseUrl(options.env);
  const secretValues = await fetchSecrets(mappings, apiKey, baseUrl);

  // Metadata to stderr so the child process owns stdout.
  if (isJsonMode()) {
    console.error(
      JSON.stringify({
        status: 'ok',
        message: 'Injected secrets into child process',
        env: options.env ?? null,
        injected: mappings.map(({ envVar, vaultName }) => ({ envVar, vaultName })),
      }),
    );
  }

  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const [envVar, value] of secretValues) {
    childEnv[envVar] = value;
  }

  const [cmd, ...args] = options.command;
  return spawnChild(cmd, args, childEnv);
}
