import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeSkills } from './runtime.js';
import { embeddedReferencePath } from './skills.js';

describe('embeddedReferencePath', () => {
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'wos-skref-'));
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('points at the reference file materializeSkills actually writes', async () => {
    // The reference layout the @workos/skills package uses on disk.
    const files = {
      'plugins/workos/skills/workos/references/workos-authkit-base.md': Buffer.from('REF-CONTENT').toString('base64'),
    };
    const pluginPath = await materializeSkills(files, 'v1', join(base, 'rt'));

    const refPath = embeddedReferencePath(pluginPath, 'workos-authkit-base');

    expect(await readFile(refPath, 'utf-8')).toBe('REF-CONTENT');
  });
});
