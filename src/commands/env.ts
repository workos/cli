import chalk from 'chalk';
import ui from '../utils/ui.js';
import { getConfig, saveConfig, isUnclaimedEnvironment, freshEnvKey } from '../lib/config-store.js';
import type { CliConfig } from '../lib/config-store.js';
import { getApiBaseUrlSource } from '../lib/api-key.js';
import { outputSuccess, outputJson, exitWithError, isJsonMode } from '../utils/output.js';
import { isAgentMode, isCiMode, isPromptAllowed } from '../utils/interaction-mode.js';
import { missingArgsRecovery } from '../utils/recovery-hints.js';
import { formatWorkOSCommand } from '../utils/command-invocation.js';
import { ExitCode, exitWithCode } from '../utils/exit-codes.js';
import {
  provisionUnclaimedEnvironment,
  UnclaimedEnvApiError,
  type UnclaimedEnvProvisionResult,
} from '../lib/unclaimed-env-api.js';
import { tryResolveProfileEnvironmentId } from '../lib/environment-target.js';

const ENV_NAME_REGEX = /^[a-z0-9\-_]+$/;

function validateEnvName(name: string | undefined): string | undefined {
  if (!name || !ENV_NAME_REGEX.test(name)) {
    return 'Name must contain only lowercase letters, numbers, hyphens, and underscores';
  }
  return undefined;
}

function getOrCreateConfig(): CliConfig {
  return getConfig() ?? { environments: {} };
}

export async function runEnvAdd(options: {
  name?: string;
  apiKey?: string;
  clientId?: string;
  endpoint?: string;
}): Promise<void> {
  let { name, apiKey, endpoint } = options;
  const { clientId } = options;

  if (name && apiKey) {
    // Non-interactive mode
    const nameError = validateEnvName(name);
    if (nameError) {
      exitWithError({ code: 'invalid_args', message: nameError });
    }
  } else if (!isPromptAllowed()) {
    exitWithError({
      code: 'missing_args',
      message: isAgentMode()
        ? `Name and API key required in agent mode. Example: ${formatWorkOSCommand('env add staging sk_test_xxx --client-id client_xxx')}`
        : isCiMode()
          ? 'Name and API key required in CI mode.'
          : 'Name and API key required when prompting is unavailable.',
      recovery: missingArgsRecovery(undefined, 'Provide environment name and API key as positional arguments.'),
    });
  } else {
    // Interactive mode
    const nameResult = await ui.text({
      message: 'Enter a name for the environment (e.g., production, sandbox, local)',
      validate: (value) => validateEnvName(value),
    });
    if (ui.isCancel(nameResult)) exitWithCode(ExitCode.CANCELLED);
    name = nameResult;

    const typeResult = await ui.select({
      message: 'Select the environment type',
      options: [
        { value: 'production', label: 'Production' },
        { value: 'sandbox', label: 'Sandbox' },
      ],
    });
    if (ui.isCancel(typeResult)) exitWithCode(ExitCode.CANCELLED);

    const apiKeyResult = await ui.password({
      message: 'Enter the API key for this environment',
      validate: (value) => {
        if (!value) return 'API key is required';
        return undefined;
      },
    });
    if (ui.isCancel(apiKeyResult)) exitWithCode(ExitCode.CANCELLED);
    apiKey = apiKeyResult;

    const config = getOrCreateConfig();
    const isFirst = Object.keys(config.environments).length === 0;

    config.environments[name] = {
      name,
      type: typeResult as 'production' | 'sandbox',
      apiKey,
      ...(clientId && { clientId }),
      ...(endpoint && { endpoint }),
    };

    if (isFirst) {
      config.activeEnvironment = name;
    }

    saveConfig(config);
    ui.log.success(`Environment ${chalk.bold(name)} added`);
    if (isFirst) {
      ui.log.info(`Set as active environment`);
    }
    // Best-effort dashboard environment resolution (clientId join or one-time
    // picker). Never blocks profile creation — when logged out, resolution
    // defers to first dashboard-command use.
    await tryResolveProfileEnvironmentId(name, { allowPicker: true });
    return;
  }

  // Non-interactive path
  const config = getOrCreateConfig();
  const isFirst = Object.keys(config.environments).length === 0;

  const type: 'production' | 'sandbox' = apiKey.startsWith('sk_test_') ? 'sandbox' : 'production';

  config.environments[name!] = {
    name: name!,
    type,
    apiKey,
    ...(clientId && { clientId }),
    ...(endpoint && { endpoint }),
  };

  if (isFirst) {
    config.activeEnvironment = name;
  }

  saveConfig(config);
  // Best-effort dashboard environment resolution (join; picker only in human
  // mode). Never blocks profile creation — defers to first dashboard use.
  await tryResolveProfileEnvironmentId(name!, { allowPicker: true });
  outputSuccess('Environment added', { name: name!, type, active: isFirst });
}

/**
 * `workos env provision` — provision a fresh unclaimed environment (credentials only).
 *
 * Calls the low-level `provisionUnclaimedEnvironment()` directly (no auth, no
 * code-gen). Credentials are delivered on stdout (JSON is the agent credential
 * channel) and persisted locally as an unclaimed env so a follow-up
 * `env claim` works. NEVER writes to the project directory or any `.env` file,
 * and NEVER falls back to an interactive login on failure.
 */
export async function runEnvProvision(): Promise<void> {
  let result: UnclaimedEnvProvisionResult;
  try {
    result = await provisionUnclaimedEnvironment();
  } catch (error) {
    if (error instanceof UnclaimedEnvApiError) {
      exitWithError({
        code: error.statusCode === 429 ? 'rate_limited' : 'provision_failed',
        message: error.message,
        ...(error.statusCode && { apiContext: { status: error.statusCode } }),
      });
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    exitWithError({ code: 'provision_failed', message: `Failed to provision environment: ${message}` });
  }

  // Persist as an unclaimed env (parity with install) — NEVER writes to the project dir.
  // A fresh key ('unclaimed', 'unclaimed-2', …) so a repeated provision never clobbers an
  // earlier env's claim token, which lives only in this config and is unrecoverable.
  const config = getOrCreateConfig();
  const key = freshEnvKey(config, 'unclaimed');
  config.environments[key] = {
    name: key,
    type: 'unclaimed',
    apiKey: result.apiKey,
    clientId: result.clientId,
    claimToken: result.claimToken,
  };
  config.activeEnvironment = key;
  saveConfig(config);

  if (isJsonMode()) {
    outputSuccess('Environment provisioned', {
      name: key,
      type: 'unclaimed',
      active: true,
      apiKey: result.apiKey,
      clientId: result.clientId,
      claimToken: result.claimToken,
      authkitDomain: result.authkitDomain,
    });
    return;
  }

  ui.log.success('Provisioned a new WorkOS environment');
  console.log('');
  console.log(`  ${chalk.dim('API key')}     ${result.apiKey}`);
  console.log(`  ${chalk.dim('Client ID')}   ${result.clientId}`);
  console.log(`  ${chalk.dim('AuthKit')}     ${result.authkitDomain}`);
  console.log('');
  ui.log.info(
    `Set as active environment (${key}). Run \`${formatWorkOSCommand('env claim')}\` to link it to your account (permanent).`,
  );
  if (key !== 'unclaimed') {
    ui.log.info(`Your earlier unclaimed environment(s) are kept. See \`${formatWorkOSCommand('env list')}\`.`);
  }
}

export async function runEnvRemove(name: string): Promise<void> {
  const config = getConfig();
  if (!config || Object.keys(config.environments).length === 0) {
    exitWithError({
      code: 'no_environments',
      message: `No environments configured. Run \`${formatWorkOSCommand('env add')}\` to get started.`,
    });
  }

  if (!config.environments[name]) {
    const available = Object.keys(config.environments).join(', ');
    exitWithError({ code: 'not_found', message: `Environment "${name}" not found. Available: ${available}` });
  }

  // Capture the claim risk BEFORE deleting — an unclaimed env's claim token lives
  // only in this local config, so removing it permanently loses the ability to claim.
  const wasUnclaimed = isUnclaimedEnvironment(config.environments[name]);

  delete config.environments[name];

  if (!isJsonMode()) {
    ui.log.warn(
      wasUnclaimed
        ? `Removed only the local CLI config for "${name}". This environment was unclaimed — its claim token lived only here, so it can no longer be claimed.`
        : `Removed only the local CLI config for "${name}". The environment still exists in WorkOS.`,
    );
  }

  if (config.activeEnvironment === name) {
    const remaining = Object.keys(config.environments);
    config.activeEnvironment = remaining.length > 0 ? remaining[0] : undefined;
    if (config.activeEnvironment && !isJsonMode()) {
      ui.log.info(`Active environment switched to ${chalk.bold(config.activeEnvironment)}`);
    }
  }

  saveConfig(config);
  outputSuccess('Environment removed', {
    name,
    newActive: config.activeEnvironment ?? null,
    localOnly: true,
    wasUnclaimed,
  });
}

export async function runEnvSwitch(name?: string): Promise<void> {
  const config = getConfig();
  if (!config || Object.keys(config.environments).length === 0) {
    exitWithError({
      code: 'no_environments',
      message: `No environments configured. Run \`${formatWorkOSCommand('env add')}\` to get started.`,
    });
  }

  if (name) {
    if (!config.environments[name]) {
      const available = Object.keys(config.environments).join(', ');
      exitWithError({ code: 'not_found', message: `Environment "${name}" not found. Available: ${available}` });
    }
  } else {
    // Interactive selection (TTY only — non-TTY guard is in bin.ts)
    const options = Object.entries(config.environments).map(([key, env]) => {
      let label = key;
      if (env.type === 'sandbox') label += ` [Sandbox]`;
      if (env.endpoint) label += ` [${env.endpoint}]`;
      if (key === config.activeEnvironment) label += chalk.green(' (active)');
      return { value: key, label };
    });

    const selected = await ui.select({
      message: 'Select an environment',
      options,
    });
    if (ui.isCancel(selected)) exitWithCode(ExitCode.CANCELLED);
    name = selected as string;
  }

  config.activeEnvironment = name;
  saveConfig(config);

  const env = config.environments[name];

  // Switching to a profile that has never resolved its dashboard environment:
  // attempt the clientId join (or the one-time picker in human mode) now.
  // Best-effort — a logged-out switch defers resolution to first dashboard use.
  if (!env.environmentId) {
    await tryResolveProfileEnvironmentId(name, { allowPicker: true });
  }

  const warnings = process.env.WORKOS_API_KEY
    ? [
        {
          code: 'env_var_override',
          message:
            "WORKOS_API_KEY is set in your shell. It will override this environment's stored key unless you pass --api-key.",
        },
      ]
    : undefined;
  outputSuccess('Switched environment', { name, type: env.type }, { warnings });
}

export async function runEnvList(): Promise<void> {
  const config = getConfig();
  if (!config || Object.keys(config.environments).length === 0) {
    if (isJsonMode()) {
      outputJson({ data: [] });
    } else {
      ui.log.info(`No environments configured. Run \`${formatWorkOSCommand('env add')}\` to get started.`);
    }
    return;
  }

  const entries = Object.entries(config.environments);
  const baseUrlSource = getApiBaseUrlSource();
  // Only an env-var override supersedes the stored profiles below; a profile
  // endpoint is already shown in the table, so don't double-report it here.
  const override = baseUrlSource.source === 'env' ? { baseUrl: baseUrlSource.baseUrl, via: baseUrlSource.via } : null;

  if (isJsonMode()) {
    const data = entries.map(([key, env]) => ({
      name: key,
      type: env.type,
      active: key === config.activeEnvironment,
      endpoint: env.endpoint ?? null,
      hasApiKey: !!env.apiKey,
      hasClientId: !!env.clientId,
    }));
    outputJson({ data, override });
    return;
  }

  // Human-mode table
  const hasUnclaimed = entries.some(([, env]) => isUnclaimedEnvironment(env));
  const nameW =
    Math.max(6, ...entries.map(([k, env]) => k.length + (isUnclaimedEnvironment(env) ? ' (unclaimed)'.length : 0))) + 2;
  const typeW = 12;

  const header = [
    chalk.yellow('  '),
    chalk.yellow('Name'.padEnd(nameW)),
    chalk.yellow('Type'.padEnd(typeW)),
    chalk.yellow('Endpoint'),
  ].join('  ');

  const separator = chalk.dim('─'.repeat(header.length));

  console.log(header);
  console.log(separator);

  for (const [key, env] of entries) {
    const isActive = key === config.activeEnvironment;
    const marker = isActive ? chalk.green('▸ ') : '  ';
    const unclaimed = isUnclaimedEnvironment(env);
    const displayName = unclaimed ? `${key} ${chalk.yellow('(unclaimed)')}` : key;
    const name = isActive ? chalk.green(displayName.padEnd(nameW)) : displayName.padEnd(nameW);
    const type = unclaimed ? 'Unclaimed' : env.type === 'sandbox' ? 'Sandbox' : 'Production';
    const endpoint = env.endpoint || chalk.dim('default');

    console.log([marker, name, type.padEnd(typeW), endpoint].join('  '));
  }

  if (hasUnclaimed) {
    console.log('');
    console.log(chalk.dim(`  Run \`${formatWorkOSCommand('env claim')}\` to keep this environment.`));
  }

  if (override) {
    console.log('');
    console.log(
      chalk.yellow(`Override: ${override.via}=${override.baseUrl} `) + chalk.dim('(active for all commands)'),
    );
  }
}
