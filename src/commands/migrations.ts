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

export async function runMigrations(args: string[], apiKey: string): Promise<void> {
  process.env.WORKOS_SECRET_KEY = apiKey;

  const { program } = (await import('@workos/migrations/dist/cli/index.js')) as {
    program: {
      name(str: string): unknown;
      parseAsync(argv: string[], options?: { from: 'user' }): Promise<unknown>;
    };
  };

  program.name('workos migrations');
  await program.parseAsync(args, { from: 'user' });
}
