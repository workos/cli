import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectPort, getCallbackPath } from './port-detection.js';

describe('port-detection — python/Django defaults', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns 8000 for python', () => {
    expect(detectPort('python', dir)).toBe(8000);
  });

  it('returns /auth/callback/ for python', () => {
    expect(getCallbackPath('python')).toBe('/auth/callback/');
  });
});

describe('port-detection — non-JS integration defaults', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-defaults-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each([
    ['ruby', 3000],
    ['php', 8000],
    ['php-laravel', 8000],
    ['go', 8080],
    ['dotnet', 5000],
    ['elixir', 4000],
    ['kotlin', 8080],
  ] as const)('%s falls back to port %i when no config file present', (integration, expectedPort) => {
    expect(detectPort(integration, dir)).toBe(expectedPort);
  });
});

describe('port-detection — dotnet launchSettings.json', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-dotnet-'));
    await mkdir(join(dir, 'Properties'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses port from http applicationUrl', async () => {
    await writeFile(
      join(dir, 'Properties', 'launchSettings.json'),
      JSON.stringify({
        profiles: { Example: { applicationUrl: 'http://localhost:5123;https://localhost:7123' } },
      }),
    );
    expect(detectPort('dotnet', dir)).toBe(5123);
  });

  it('falls back to default when JSON is malformed', async () => {
    await writeFile(join(dir, 'Properties', 'launchSettings.json'), '{ not json');
    expect(detectPort('dotnet', dir)).toBe(5000);
  });
});

describe('port-detection — elixir/phoenix config', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-elixir-'));
    await mkdir(join(dir, 'config'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses port from config/dev.exs', async () => {
    await writeFile(
      join(dir, 'config', 'dev.exs'),
      'config :my_app, MyAppWeb.Endpoint,\n  http: [ip: {127, 0, 0, 1}, port: 4567]\n',
    );
    expect(detectPort('elixir', dir)).toBe(4567);
  });

  it('falls back to runtime.exs when dev.exs missing', async () => {
    await writeFile(join(dir, 'config', 'runtime.exs'), 'port: 4321\n');
    expect(detectPort('elixir', dir)).toBe(4321);
  });
});

describe('port-detection — kotlin/spring boot', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-kotlin-'));
    await mkdir(join(dir, 'src', 'main', 'resources'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses port from application.properties', async () => {
    await writeFile(join(dir, 'src', 'main', 'resources', 'application.properties'), 'server.port=9090\n');
    expect(detectPort('kotlin', dir)).toBe(9090);
  });

  it('parses port from application.yml nested under server:', async () => {
    await writeFile(
      join(dir, 'src', 'main', 'resources', 'application.yml'),
      'spring:\n  profiles:\n    active: dev\nserver:\n  port: 9191\n',
    );
    expect(detectPort('kotlin', dir)).toBe(9191);
  });
});

describe('port-detection — ruby/rails puma', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-ruby-'));
    await mkdir(join(dir, 'config'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses port from ENV.fetch block form', async () => {
    await writeFile(join(dir, 'config', 'puma.rb'), 'port ENV.fetch("PORT") { 3456 }\n');
    expect(detectPort('ruby', dir)).toBe(3456);
  });

  it('parses port from ENV.fetch two-arg form', async () => {
    await writeFile(join(dir, 'config', 'puma.rb'), 'port ENV.fetch("PORT", 3789)\n');
    expect(detectPort('ruby', dir)).toBe(3789);
  });

  it('parses literal port directive', async () => {
    await writeFile(join(dir, 'config', 'puma.rb'), 'workers 2\nport 4000\n');
    expect(detectPort('ruby', dir)).toBe(4000);
  });
});

describe('port-detection — tanstack-start config', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-tanstack-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('parses port from vite.config.ts (modern @tanstack/react-start)', async () => {
    await writeFile(
      join(dir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nexport default defineConfig({ server: { host: '::', port: 8080 }, plugins: [] })\n",
    );
    expect(detectPort('tanstack-start', dir)).toBe(8080);
  });

  it('falls back to legacy app.config.ts (Vinxi) when no vite config', async () => {
    await writeFile(join(dir, 'app.config.ts'), 'export default { server: { port: 4200 } }\n');
    expect(detectPort('tanstack-start', dir)).toBe(4200);
  });

  it('prefers vite.config.ts over app.config.ts when both present', async () => {
    await writeFile(
      join(dir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nexport default defineConfig({ server: { port: 8080 } })\n",
    );
    await writeFile(join(dir, 'app.config.ts'), 'export default { server: { port: 4200 } }\n');
    expect(detectPort('tanstack-start', dir)).toBe(8080);
  });

  it.each(['vite.config.js', 'vite.config.mjs'])('parses port from %s', async (fileName) => {
    await writeFile(join(dir, fileName), 'export default { server: { port: 5555 } }\n');
    expect(detectPort('tanstack-start', dir)).toBe(5555);
  });

  it('falls back to default 3000 when no config file present', () => {
    expect(detectPort('tanstack-start', dir)).toBe(3000);
  });
});

describe('port-detection — vite frameworks', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'port-vite-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it.each(['react', 'react-router', 'vanilla-js'] as const)('%s parses port from vite.config.ts', async (framework) => {
    await writeFile(
      join(dir, 'vite.config.ts'),
      "import { defineConfig } from 'vite'\nexport default defineConfig({ server: { port: 4200 } })\n",
    );
    expect(detectPort(framework, dir)).toBe(4200);
  });

  it.each(['react', 'react-router', 'vanilla-js'] as const)(
    '%s falls back to default 5173 when no vite config present',
    (framework) => {
      expect(detectPort(framework, dir)).toBe(5173);
    },
  );
});
