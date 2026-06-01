import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockParseAsync = vi.fn();
const mockName = vi.fn();

vi.mock('@workos/migrations/dist/cli/index.js', () => ({
  program: { parseAsync: mockParseAsync, name: mockName },
}));

const { getMigrationsPassthroughArgs, runMigrations } = await import('./migrations.js');

describe('runMigrations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.WORKOS_SECRET_KEY;
    delete process.env.WORKOS_API_URL;
  });

  it('sets WORKOS_SECRET_KEY from the provided API key', async () => {
    await runMigrations(['import', '--csv', 'users.csv'], 'sk_test_123');
    expect(process.env.WORKOS_SECRET_KEY).toBe('sk_test_123');
  });

  it('does not require WORKOS_SECRET_KEY when no API key is provided', async () => {
    await runMigrations(['wizard']);
    expect(process.env.WORKOS_SECRET_KEY).toBeUndefined();
    expect(mockParseAsync).toHaveBeenCalledWith(['wizard'], { from: 'user' });
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

  it('sets WORKOS_API_URL when apiBaseUrl is provided', async () => {
    await runMigrations(['import', '--csv', 'users.csv'], 'sk_test_123', 'https://api.staging.workos.com');
    expect(process.env.WORKOS_API_URL).toBe('https://api.staging.workos.com');
  });

  it('does not set WORKOS_API_URL when apiBaseUrl is undefined', async () => {
    await runMigrations(['import', '--csv', 'users.csv'], 'sk_test_123');
    expect(process.env.WORKOS_API_URL).toBeUndefined();
  });

  it('removes WorkOS global flags from migrations passthrough args', () => {
    expect(
      getMigrationsPassthroughArgs([
        'migrations',
        'import',
        '--csv',
        'users.csv',
        '--mode',
        'agent',
        '--api-key',
        'sk_test_123',
        '--insecure-storage',
        '--json',
      ]),
    ).toEqual(['import', '--csv', 'users.csv']);
  });

  it('removes WorkOS global flags with inline values from migrations passthrough args', () => {
    expect(
      getMigrationsPassthroughArgs([
        'migrations',
        'import',
        '--csv',
        'users.csv',
        '--mode=ci',
        '--api-key=sk_test_123',
      ]),
    ).toEqual(['import', '--csv', 'users.csv']);
  });

  it('starts passthrough at the migrations command, not a WorkOS flag value', () => {
    expect(
      getMigrationsPassthroughArgs([
        '--mode',
        'migrations',
        '--api-key=migrations',
        'migrations',
        'import',
        '--csv',
        'users.csv',
      ]),
    ).toEqual(['import', '--csv', 'users.csv']);
  });
});
