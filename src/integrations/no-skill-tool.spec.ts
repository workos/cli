import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const integrationsDir = join(import.meta.dirname, '.');

/**
 * Guard against regressions where integration prompts reference the Skill tool.
 * All integrations should inject reference content from @workos/skills directly,
 * not tell the agent to invoke a skill.
 */
describe('no Skill tool references in integrations', () => {
  const integrationDirs = readdirSync(integrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const dir of integrationDirs) {
    const indexPath = join(integrationsDir, dir, 'index.ts');
    let content: string;
    try {
      content = readFileSync(indexPath, 'utf-8');
    } catch {
      continue; // skip dirs without index.ts
    }

    it(`${dir}/index.ts should not tell agent to invoke a skill`, () => {
      expect(content).not.toMatch(/Begin by invoking.*skill/i);
      expect(content).not.toMatch(/Use the (?:`|\\`)\$\{.*\}(?:`|\\`) skill to integrate/i);
    });
  }
});

describe('allowedTools does not include Skill', () => {
  it('agent-interface.ts should not list Skill in allowedTools', () => {
    const content = readFileSync(join(import.meta.dirname, '..', 'lib', 'agent-interface.ts'), 'utf-8');
    const match = content.match(/allowedTools:\s*\[([^\]]+)\]/);
    expect(match).toBeTruthy();
    expect(match![1]).not.toContain("'Skill'");
  });
});
