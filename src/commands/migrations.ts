import { loadRuntimeBundle } from '../lib/runtime-assets.js';
import { getWorkOSCommand } from '../utils/command-invocation.js';

/** The commander surface the CLI drives; the compiled-in package is the compile-time contract. */
type MigrationsProgram = {
  name(str: string): unknown;
  parseAsync(argv: string[], options?: { from: 'user' }): Promise<unknown>;
};

/**
 * Prefer the runtime-downloaded @workos/migrations bundle (exports `program`;
 * see lib/runtime-assets.ts), falling back to the compiled-in package when no
 * bundle is available or it lacks the expected export shape.
 */
async function resolveMigrationsProgram(): Promise<MigrationsProgram> {
  const bundle = await loadRuntimeBundle('migrations');
  const candidate = bundle?.program as Partial<MigrationsProgram> | undefined;
  if (typeof candidate?.name === 'function' && typeof candidate?.parseAsync === 'function') {
    return candidate as MigrationsProgram;
  }
  const compiledIn = (await import('@workos/migrations/dist/cli/index.js')) as { program: MigrationsProgram };
  return compiledIn.program;
}

const workosOnlyMigrationsFlags = new Map([
  ['--api-key', true],
  ['--insecure-storage', false],
  ['--json', false],
  ['--mode', true],
]);

export function getMigrationsPassthroughArgs(rawArgs: string[]): string[] {
  let migrationsIdx = rawArgs.indexOf('migrations');

  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    const key = arg.split('=')[0];
    const takesValue = workosOnlyMigrationsFlags.get(key);

    if (takesValue !== undefined) {
      if (takesValue && !arg.includes('=')) i++;
      continue;
    }

    if (arg === 'migrations') {
      migrationsIdx = i;
      break;
    }
  }

  const after = rawArgs.slice(migrationsIdx + 1);
  const passthrough: string[] = [];

  for (let i = 0; i < after.length; i++) {
    const arg = after[i];
    const key = arg.split('=')[0];
    const takesValue = workosOnlyMigrationsFlags.get(key);

    if (takesValue !== undefined) {
      if (takesValue && !arg.includes('=')) i++;
      continue;
    }

    passthrough.push(arg);
  }

  return passthrough;
}

export async function runMigrations(args: string[], apiKey?: string, apiBaseUrl?: string): Promise<void> {
  if (apiKey) {
    process.env.WORKOS_SECRET_KEY = apiKey;
  }
  if (apiBaseUrl) {
    process.env.WORKOS_API_URL = apiBaseUrl;
  }

  const program = await resolveMigrationsProgram();

  program.name(`${getWorkOSCommand()} migrations`);
  await program.parseAsync(args, { from: 'user' });
}
