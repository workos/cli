import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
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
  const dir = '/';

  it.each([
    ['ruby', 3000],
    ['php', 8000],
    ['php-laravel', 8000],
    ['go', 8080],
    ['dotnet', 5000],
    ['elixir', 4000],
    ['kotlin', 8080],
  ] as const)('%s defaults to port %i', (integration, expectedPort) => {
    expect(detectPort(integration, dir)).toBe(expectedPort);
  });
});
