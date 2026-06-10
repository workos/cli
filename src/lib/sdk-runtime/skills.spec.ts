import { describe, it, expect } from 'vitest';
import { referenceFromEmbedded } from './skills.js';

describe('referenceFromEmbedded', () => {
  // Key layout matches scripts/build-binary.ts buildSkillsMap: paths relative
  // to the @workos/skills package root, base64-encoded contents.
  const files = {
    'plugins/workos/skills/workos/references/workos-authkit-base.md': Buffer.from('REF-CONTENT').toString('base64'),
    'plugins/workos/skills/workos/SKILL.md': Buffer.from('ROUTER').toString('base64'),
  };

  it('decodes a reference straight from the embedded map (no filesystem)', () => {
    expect(referenceFromEmbedded(files, 'workos-authkit-base')).toBe('REF-CONTENT');
  });

  it('throws a descriptive error for a missing reference', () => {
    expect(() => referenceFromEmbedded(files, 'workos-nope')).toThrow(/workos-nope/);
  });
});
