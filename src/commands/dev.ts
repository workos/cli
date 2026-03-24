import { createEmulator, type EmulatorSeedConfig } from '../emulate/index.js';
import { resolveDevCommand } from '../lib/dev-command.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import chalk from 'chalk';

export interface DevArgs {
  port: number;
  seed?: string;
  '--'?: string[];
}

function loadSeedFile(filePath: string): EmulatorSeedConfig {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    console.error(`Seed file not found: ${resolved}`);
    process.exit(1);
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

/**
 * Build the env vars object to inject into the child process.
 */
export function buildDevEnv(emulatorUrl: string): Record<string, string> {
  return {
    WORKOS_API_BASE_URL: emulatorUrl,
    WORKOS_API_KEY: 'sk_test_default',
    WORKOS_CLIENT_ID: 'client_emulated',
  };
}

export async function runDev(argv: DevArgs): Promise<void> {
  const seedConfig = argv.seed ? loadSeedFile(argv.seed) : autoDetectSeedFile();

  // 1. Start emulator
  const emulator = await createEmulator({
    port: argv.port,
    seed: seedConfig ?? undefined,
  });

  // 2. Resolve dev command
  const explicit = argv['--'];
  const devCmd =
    explicit && explicit.length > 0
      ? { command: explicit[0], args: explicit.slice(1), framework: null as string | null }
      : await resolveDevCommand(process.cwd());

  // 3. Print status banner
  console.log();
  console.log(`${chalk.cyan('WorkOS Emulate')} ${chalk.dim(emulator.url)}`);
  if (devCmd.framework) {
    console.log(chalk.dim(`Detected ${devCmd.framework}`));
  }
  console.log(chalk.dim(`Running: ${devCmd.command} ${devCmd.args.join(' ')}`));
  console.log();

  // 4. Spawn child process with env vars
  let child: ChildProcess;
  try {
    child = spawn(devCmd.command, devCmd.args, {
      stdio: 'inherit',
      env: {
        ...process.env,
        ...buildDevEnv(emulator.url),
      },
    });
  } catch {
    console.error(chalk.red(`Failed to start: ${devCmd.command} ${devCmd.args.join(' ')}`));
    console.error(chalk.dim('Try specifying the command explicitly: workos dev -- <your-command>'));
    await emulator.close();
    process.exit(1);
  }

  child.on('error', async (err) => {
    console.error(chalk.red(`Failed to start: ${devCmd.command}`));
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(chalk.dim(`Command not found: ${devCmd.command}`));
      console.error(chalk.dim('Try specifying the command explicitly: workos dev -- <your-command>'));
    } else {
      console.error(chalk.dim(err.message));
    }
    await emulator.close();
    process.exit(1);
  });

  // 5. Signal handling — forward to child, then close emulator
  const shutdown = (signal: NodeJS.Signals) => {
    child.kill(signal);
    emulator.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 6. If child exits, close emulator and exit with same code
  child.on('exit', (code) => {
    emulator.close().then(() => process.exit(code ?? 0));
  });
}
