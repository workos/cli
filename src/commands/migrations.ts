export async function runMigrations(args: string[], apiKey: string): Promise<void> {
  process.env.WORKOS_SECRET_KEY = apiKey;

  const { program } = (await import('workos-migrations/dist/cli/index.js')) as {
    program: { parseAsync(argv: string[], options?: { from: 'user' }): Promise<unknown> };
  };

  await program.parseAsync(args, { from: 'user' });
}
