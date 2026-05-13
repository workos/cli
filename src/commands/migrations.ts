export async function runMigrations(args: string[], apiKey: string): Promise<void> {
  process.env.WORKOS_SECRET_KEY = apiKey;

  const { program } = (await import('workos-migrations/dist/cli/index.js')) as {
    program: {
      name(str: string): unknown;
      parseAsync(argv: string[], options?: { from: 'user' }): Promise<unknown>;
    };
  };

  program.name('workos migrations');
  await program.parseAsync(args, { from: 'user' });
}
