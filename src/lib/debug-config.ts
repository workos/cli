import { getConfig, getCliAuthClientId, getAuthkitDomain, getLlmGatewayUrl } from './settings.js';
import { getWorkOSApiUrl, getWorkOSDashboardUrl } from '../utils/urls.js';
import { IS_DEV, WIZARD_TELEMETRY_ENABLED } from './constants.js';
import chalk from 'chalk';

interface ConfigValue {
  name: string;
  envVar: string;
  currentValue: string;
  defaultValue: string;
  isOverridden: boolean;
}

function getConfigValues(): ConfigValue[] {
  const config = getConfig();

  return [
    // WorkOS service URLs
    {
      name: 'Client ID',
      envVar: 'WORKOS_CLIENT_ID',
      currentValue: getCliAuthClientId(),
      defaultValue: config.workos.clientId,
      isOverridden: !!process.env.WORKOS_CLIENT_ID,
    },
    {
      name: 'AuthKit Domain',
      envVar: 'WORKOS_AUTHKIT_DOMAIN',
      currentValue: getAuthkitDomain(),
      defaultValue: config.workos.authkitDomain,
      isOverridden: !!process.env.WORKOS_AUTHKIT_DOMAIN,
    },
    {
      name: 'LLM Gateway URL',
      envVar: 'WORKOS_LLM_GATEWAY_URL',
      currentValue: getLlmGatewayUrl(),
      defaultValue: config.workos.llmGatewayUrl,
      isOverridden: !!process.env.WORKOS_LLM_GATEWAY_URL,
    },
    {
      name: 'API URL',
      envVar: 'WORKOS_API_URL',
      currentValue: getWorkOSApiUrl(),
      defaultValue: 'https://api.workos.com',
      isOverridden: !!process.env.WORKOS_API_URL,
    },
    {
      name: 'Dashboard URL',
      envVar: 'WORKOS_DASHBOARD_URL',
      currentValue: getWorkOSDashboardUrl(),
      defaultValue: 'https://dashboard.workos.com',
      isOverridden: !!process.env.WORKOS_DASHBOARD_URL,
    },
    // Telemetry
    {
      name: 'Telemetry',
      envVar: 'WIZARD_TELEMETRY',
      currentValue: WIZARD_TELEMETRY_ENABLED ? 'enabled' : 'disabled',
      defaultValue: 'enabled',
      isOverridden: process.env.WIZARD_TELEMETRY === 'false',
    },
  ];
}

function getCliEnvVars(): { name: string; envVar: string; description: string }[] {
  return [
    { name: 'debug', envVar: 'WORKOS_WIZARD_DEBUG', description: 'Enable verbose logging' },
    { name: 'default', envVar: 'WORKOS_WIZARD_DEFAULT', description: 'Use default options for prompts' },
    { name: 'local', envVar: 'WORKOS_WIZARD_LOCAL', description: 'Use local services' },
    { name: 'ci', envVar: 'WORKOS_WIZARD_CI', description: 'Enable CI mode' },
    { name: 'skip-auth', envVar: 'WORKOS_WIZARD_SKIP_AUTH', description: 'Skip authentication' },
    { name: 'api-key', envVar: 'WORKOS_WIZARD_API_KEY', description: 'WorkOS API key' },
    { name: 'client-id', envVar: 'WORKOS_WIZARD_CLIENT_ID', description: 'WorkOS Client ID' },
    { name: 'homepage-url', envVar: 'WORKOS_WIZARD_HOMEPAGE_URL', description: 'App homepage URL' },
    { name: 'redirect-uri', envVar: 'WORKOS_WIZARD_REDIRECT_URI', description: 'OAuth redirect URI' },
    { name: 'install-dir', envVar: 'WORKOS_WIZARD_INSTALL_DIR', description: 'Installation directory' },
    { name: 'no-validate', envVar: 'WORKOS_WIZARD_NO_VALIDATE', description: 'Skip validation' },
    { name: 'no-build', envVar: 'WORKOS_WIZARD_NO_BUILD', description: 'Skip build verification' },
    { name: 'force-install', envVar: 'WORKOS_WIZARD_FORCE_INSTALL', description: 'Force package install' },
  ];
}

export function printDebugConfig(): void {
  const config = getConfig();
  const configValues = getConfigValues();
  const cliEnvVars = getCliEnvVars();

  console.log(chalk.bold.cyan('\n═══ WorkOS AuthKit Wizard Configuration ═══\n'));

  // Runtime info
  console.log(chalk.bold('Runtime:'));
  console.log(`  Node.js:     ${process.version}`);
  console.log(`  Dev Mode:    ${IS_DEV ? chalk.yellow('yes') : 'no'}`);
  console.log(`  Model:       ${config.model}`);
  console.log(`  Log File:    ${config.logging.logFile}`);
  console.log();

  // Service URLs section
  console.log(chalk.bold('Service Configuration:'));
  console.log(chalk.dim('  (values can be overridden via environment variables)\n'));

  const maxNameLen = Math.max(...configValues.map((v) => v.name.length));

  for (const val of configValues) {
    const nameCol = val.name.padEnd(maxNameLen);
    const status = val.isOverridden ? chalk.green('● ENV') : chalk.dim('○ default');
    const value = val.isOverridden ? chalk.green(val.currentValue) : chalk.dim(val.currentValue);

    console.log(`  ${nameCol}  ${status}  ${value}`);
    console.log(chalk.dim(`  ${''.padEnd(maxNameLen)}  └─ ${val.envVar}`));
  }

  console.log();

  // CLI options that can be set via env vars
  console.log(chalk.bold('CLI Environment Variables:'));
  console.log(chalk.dim('  (set any of these to configure CLI behavior)\n'));

  for (const opt of cliEnvVars) {
    const envValue = process.env[opt.envVar];
    const status = envValue !== undefined ? chalk.green('● SET') : chalk.dim('○ unset');
    const value = envValue !== undefined ? chalk.green(envValue) : '';

    console.log(`  ${opt.envVar}`);
    console.log(`    ${status} ${value} ${chalk.dim(`(${opt.description})`)}`);
  }

  console.log();

  // Framework defaults
  console.log(chalk.bold('Framework Defaults:'));
  for (const [framework, settings] of Object.entries(config.frameworks)) {
    console.log(`  ${framework.padEnd(15)} port: ${settings.port}, callback: ${settings.callbackPath}`);
  }

  console.log();
}
