import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FizzyGrader, FIZZY_ACCEPTANCE } from './fizzy.grader.js';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'fizzy-grader-'));
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('Network forbidden');
    }),
  );
  for (const path of ['app/controllers', 'app/views/layouts', 'config'])
    await mkdir(join(directory, path), { recursive: true });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

it.each([
  ['unused SDK strings', '# authorization_url authenticate_with_code sealed_session'],
  ['hardcoded identity', 'def callback; authenticate_with_code; Current.identity = Identity.first; end'],
  [
    'duplicate provisioning',
    'def callback; authenticate_with_code; Identity.create!; Account.create!; User.create!; end',
  ],
  ['logout leaving access', 'def logout; redirect_to root_path; end # authenticate_with_code'],
  [
    'plausible source without runtime evidence',
    'def callback; result = authenticate_with_code; start_new_session_for(mapped_identity(result)); end',
  ],
])('never treats %s as proven acceptance', async (_label, source) => {
  await writeFile(join(directory, 'Gemfile'), 'gem "workos"');
  await writeFile(join(directory, 'app/controllers/auth_controller.rb'), source);
  await writeFile(join(directory, 'config/routes.rb'), 'get "/auth/login", to: "auth#login"');
  await writeFile(
    join(directory, 'app/views/layouts/application.html.erb'),
    '<a href="/auth/login">Sign in</a><button>Logout</button>',
  );
  const result = await new FizzyGrader(directory).grade();
  expect(result.passed).toBe(false);
  for (const name of FIZZY_ACCEPTANCE)
    expect(result.checks.find((check) => check.name === name)).toMatchObject({
      passed: false,
      message: expect.stringContaining('UNVERIFIED'),
    });
  expect(result.checks.some((check) => check.name.startsWith('Static only:') && check.passed)).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it('reports missing UI/routes/source as absent, not successful behavior', async () => {
  const result = await new FizzyGrader(directory).grade();
  expect(result.passed).toBe(false);
  expect(result.checks.every((check) => !check.passed)).toBe(true);
});
