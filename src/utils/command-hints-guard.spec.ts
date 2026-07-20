import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';

// Resolve the src/ root from this file's location (src/utils/*.spec.ts).
const SRC_DIR = fileURLToPath(new URL('..', import.meta.url));

// Lowercase `workos` only — excludes prose like "WorkOS AuthKit" / "WorkOS Dashboard".
// NOTE: this alternation must track the top-level command families registered in
// bin.ts. When a new command family is added (PRs 5/6 etc.), add it here so its
// hardcoded hints are caught, and route the hint through formatWorkOSCommand().
const HINT_RE =
  /\bworkos (?:auth|env|config|telemetry|doctor|install|uninstall|vault|api|seed|mcp|skills|debug|organization|org|user|migrations|login|logout|whoami|dev)\b/g;

// Strip block comments then line comments (the (?<!:) guard keeps `https://` intact).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/[^\n]*/g, '');
}

// Intentional static/prose occurrences, keyed `${relPath} :: ${match}` (match = the
// 2-word `workos <sub>` prefix). Every entry is a reviewed decision, not a live hint.
const ALLOWLIST = new Set<string>([
  'bin.ts :: workos api', // yargs .example() help (static --help documentation)
  'utils/help-json.ts :: workos api', // examples array (mirrors bin.ts)
  'commands/seed.ts :: workos seed', // SEED_TEMPLATE persisted-file comment
  'emulate/workos/index.ts :: workos seed', // prose error label, not a runnable command
]);

async function discover(): Promise<Set<string>> {
  const files = await fg('**/*.ts', {
    cwd: SRC_DIR,
    absolute: true,
    ignore: ['**/*.spec.ts', '**/*.d.ts', 'utils/command-invocation.ts'],
  });
  const found = new Set<string>();
  for (const file of files) {
    const rel = relative(SRC_DIR, file);
    const stripped = stripComments(await readFile(file, 'utf-8'));
    for (const line of stripped.split('\n')) {
      if (line.includes('formatWorkOSCommand') || line.includes('getWorkOSCommand')) continue;
      for (const m of line.matchAll(HINT_RE)) found.add(`${rel} :: ${m[0]}`);
    }
  }
  return found;
}

describe('command hints route through formatWorkOSCommand', () => {
  it('has no hardcoded `workos <subcommand>` hint outside the allowlist', async () => {
    const discovered = await discover();
    const offenders = [...discovered].filter((d) => !ALLOWLIST.has(d)).sort();
    expect(
      offenders,
      `Hardcoded command hint(s) found. Route through formatWorkOSCommand()/getWorkOSCommand(), ` +
        `or add to ALLOWLIST if intentionally static: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
