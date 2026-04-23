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
