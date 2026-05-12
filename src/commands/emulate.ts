import { createEmulator, type EmulatorSeedConfig } from '../emulate/index.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import chalk from 'chalk';
import { IS_WINDOWS } from '../utils/platform.js';
import { exitWithError } from '../utils/output.js';

export interface EmulateArgs {
  port: number;
  seed?: string;
  json?: boolean;
}

function loadSeedFile(filePath: string): EmulatorSeedConfig {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    exitWithError({ code: 'seed_not_found', message: `Seed file not found: ${resolved}` });
  }

  const content = readFileSync(resolved, 'utf-8');
  if (resolved.endsWith('.json')) {
    return JSON.parse(content) as EmulatorSeedConfig;
  }
  return parseYaml(content) as EmulatorSeedConfig;
}

function autoDetectSeedFile(): EmulatorSeedConfig | null {
  const candidates = ['workos-emulate.config.yaml', 'workos-emulate.config.yml', 'workos-emulate.config.json'];

  for (const name of candidates) {
    const filePath = resolve(name);
    if (existsSync(filePath)) {
      return loadSeedFile(filePath);
    }
  }
  return null;
}

function printBanner(emulator: { url: string; port: number; apiKey: string }): void {
  console.log();
  console.log(chalk.bold('  WorkOS Emulator'));
  console.log();
  console.log(`  ${chalk.dim('URL:')}      ${emulator.url}`);
  console.log(`  ${chalk.dim('API Key:')}  ${emulator.apiKey}`);
  console.log(`  ${chalk.dim('Health:')}   ${emulator.url}/health`);
  console.log();
  console.log(chalk.dim('  Press Ctrl+C to stop'));
  console.log();
}

export async function runEmulate(argv: EmulateArgs): Promise<void> {
  const seedConfig = argv.seed ? loadSeedFile(argv.seed) : autoDetectSeedFile();

  const emulator = await createEmulator({
    port: argv.port,
    seed: seedConfig ?? undefined,
  });

  if (argv.json) {
    console.log(
      JSON.stringify({
        url: emulator.url,
        port: emulator.port,
        apiKey: emulator.apiKey,
        health: `${emulator.url}/health`,
      }),
    );
  } else {
    printBanner(emulator);
  }

  const shutdown = () => {
    if (!argv.json) console.log(`\n${chalk.dim('Shutting down...')}`);
    emulator.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  if (IS_WINDOWS) {
    process.once('SIGBREAK', shutdown);
  }
}
