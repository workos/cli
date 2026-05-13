import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockParseAsync = vi.fn();

vi.mock('workos-migrations/dist/cli/index.js', () => ({
  program: { parseAsync: mockParseAsync },
}));

const { runMigrations } = await import('./migrations.js');

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WORKOS_SECRET_KEY;
  });

  it('sets WORKOS_SECRET_KEY from the provided API key', async () => {
    await runMigrations(['import', '--csv', 'users.csv'], 'sk_test_123');
    expect(process.env.WORKOS_SECRET_KEY).toBe('sk_test_123');
  });

  it('delegates to Commander parseAsync with correct args', async () => {
    await runMigrations(['import', '--csv', 'users.csv'], 'sk_test_123');
    expect(mockParseAsync).toHaveBeenCalledWith(['import', '--csv', 'users.csv'], { from: 'user' });
  });

  it('passes empty args when no subcommand given', async () => {
    await runMigrations([], 'sk_test_456');
    expect(mockParseAsync).toHaveBeenCalledWith([], { from: 'user' });
  });

  it('forwards all migration-specific flags', async () => {
    const args = ['export-auth0', '--domain', 'example.auth0.com', '--client-id', 'abc', '--client-secret', 'xyz'];
    await runMigrations(args, 'sk_test_789');
    expect(mockParseAsync).toHaveBeenCalledWith(args, { from: 'user' });
  });
});
