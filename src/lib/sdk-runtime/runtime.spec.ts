import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeSkills } from './runtime.js';

describe('materializeSkills', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'wos-sk-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('writes the embedded file map (base64) and returns the plugin path', async () => {
    const files = {
      'plugins/workos/skills/workos/SKILL.md': Buffer.from('hello').toString('base64'),
      'plugins/workos/plugin.json': Buffer.from('{}').toString('base64'),
    };

    const pluginPath = await materializeSkills(files, '0.6.0', join(base, 'rt'));

    expect(pluginPath).toBe(join(base, 'rt', '0.6.0', 'plugins', 'workos'));
    expect(await readFile(join(pluginPath, 'skills', 'workos', 'SKILL.md'), 'utf-8')).toBe('hello');
    expect(await readFile(join(pluginPath, 'plugin.json'), 'utf-8')).toBe('{}');
  });

  it('is idempotent across calls', async () => {
    const files = { 'plugins/workos/x.md': Buffer.from('x').toString('base64') };
    const p1 = await materializeSkills(files, '0.6.0', join(base, 'rt'));
    const p2 = await materializeSkills(files, '0.6.0', join(base, 'rt'));
    expect(p2).toBe(p1);
    expect(await readFile(join(p2, 'x.md'), 'utf-8')).toBe('x');
  });
});
