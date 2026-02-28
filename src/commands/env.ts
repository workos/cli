import chalk from 'chalk';
import clack from '../utils/clack.js';
import { getConfig, saveConfig } from '../lib/config-store.js';
import type { CliConfig } from '../lib/config-store.js';
import { outputSuccess, outputJson, exitWithError, isJsonMode } from '../utils/output.js';
import { isNonInteractiveEnvironment } from '../utils/environment.js';

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
  } else if (isNonInteractiveEnvironment()) {
    exitWithError({ code: 'missing_args', message: 'Name and API key required in non-interactive mode' });
  } else {
    // Interactive mode
    const nameResult = await clack.text({
      message: 'Enter a name for the environment (e.g., production, sandbox, local)',
      validate: (value) => validateEnvName(value),
    });
    if (clack.isCancel(nameResult)) process.exit(0);
    name = nameResult;

    const typeResult = await clack.select({
      message: 'Select the environment type',
      options: [
        { value: 'production', label: 'Production' },
        { value: 'sandbox', label: 'Sandbox' },
      ],
    });
    if (clack.isCancel(typeResult)) process.exit(0);

    const apiKeyResult = await clack.password({
      message: 'Enter the API key for this environment',
      validate: (value) => {
        if (!value) return 'API key is required';
        return undefined;
      },
    });
    if (clack.isCancel(apiKeyResult)) process.exit(0);
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
    clack.log.success(`Environment ${chalk.bold(name)} added`);
    if (isFirst) {
      clack.log.info(`Set as active environment`);
    }
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
  outputSuccess('Environment added', { name: name!, type, active: isFirst });
}

export async function runEnvRemove(name: string): Promise<void> {
  const config = getConfig();
  if (!config || Object.keys(config.environments).length === 0) {
    exitWithError({
      code: 'no_environments',
      message: 'No environments configured. Run `workos env add` to get started.',
    });
  }

  if (!config.environments[name]) {
    const available = Object.keys(config.environments).join(', ');
    exitWithError({ code: 'not_found', message: `Environment "${name}" not found. Available: ${available}` });
  }

  delete config.environments[name];

  if (config.activeEnvironment === name) {
    const remaining = Object.keys(config.environments);
    config.activeEnvironment = remaining.length > 0 ? remaining[0] : undefined;
    if (config.activeEnvironment && !isJsonMode()) {
      clack.log.info(`Active environment switched to ${chalk.bold(config.activeEnvironment)}`);
    }
  }

  saveConfig(config);
  outputSuccess('Environment removed', { name, newActive: config.activeEnvironment ?? null });
}

export async function runEnvSwitch(name?: string): Promise<void> {
  const config = getConfig();
  if (!config || Object.keys(config.environments).length === 0) {
    exitWithError({
      code: 'no_environments',
      message: 'No environments configured. Run `workos env add` to get started.',
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

    const selected = await clack.select({
      message: 'Select an environment',
      options,
    });
    if (clack.isCancel(selected)) process.exit(0);
    name = selected as string;
  }

  config.activeEnvironment = name;
  saveConfig(config);

  const env = config.environments[name];
  outputSuccess('Switched environment', { name, type: env.type });
}

export async function runEnvList(): Promise<void> {
  const config = getConfig();
  if (!config || Object.keys(config.environments).length === 0) {
    if (isJsonMode()) {
      outputJson({ data: [] });
    } else {
      clack.log.info('No environments configured. Run `workos env add` to get started.');
    }
    return;
  }

  const entries = Object.entries(config.environments);

  if (isJsonMode()) {
    const data = entries.map(([key, env]) => ({
      name: key,
      type: env.type,
      active: key === config.activeEnvironment,
      endpoint: env.endpoint ?? null,
      hasApiKey: !!env.apiKey,
      hasClientId: !!env.clientId,
    }));
    outputJson({ data });
    return;
  }

  // Human-mode table
  const nameW = Math.max(6, ...entries.map(([k]) => k.length)) + 2;
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
    const name = isActive ? chalk.green(key.padEnd(nameW)) : key.padEnd(nameW);
    const type = env.type === 'sandbox' ? 'Sandbox' : 'Production';
    const endpoint = env.endpoint || chalk.dim('default');

    console.log([marker, name, type.padEnd(typeW), endpoint].join('  '));
  }
}
