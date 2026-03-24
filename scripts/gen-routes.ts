#!/usr/bin/env tsx
/**
 * Codegen script: reads a WorkOS OpenAPI spec and generates emulator TypeScript
 * files (entities, store, helpers, route stubs).
 *
 * Usage:
 *   pnpm gen:routes path/to/openapi.yaml [--out-dir src/emulate/workos/generated]
 *   pnpm gen:routes path/to/openapi.json --dry-run
 *
 * The generated code matches the hand-written patterns in src/emulate/workos/.
 * Running twice on the same spec produces identical output (idempotent).
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import YAML from 'yaml';

import {
  type OpenAPISpec,
  parseSpec,
  generateEntities,
  generateStore,
  generateHelpers,
  generateRoutes,
} from './gen-routes-lib.js';

function main(): void {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('--'));
  const positional = args.filter((a) => !a.startsWith('--'));

  const specPath = positional[0];
  if (!specPath) {
    console.error('Usage: gen-routes <openapi-spec> [--out-dir <dir>] [--dry-run]');
    process.exit(1);
  }

  const dryRun = flags.includes('--dry-run');
  const outDirIdx = args.indexOf('--out-dir');
  const outDir = outDirIdx !== -1 ? args[outDirIdx + 1] : 'src/emulate/workos/generated';

  const resolvedSpec = resolve(specPath);
  if (!existsSync(resolvedSpec)) {
    console.error(`Spec file not found: ${resolvedSpec}`);
    process.exit(1);
  }

  const raw = readFileSync(resolvedSpec, 'utf-8');
  const ext = extname(resolvedSpec).toLowerCase();
  let spec: OpenAPISpec;

  if (ext === '.yaml' || ext === '.yml') {
    spec = YAML.parse(raw) as OpenAPISpec;
  } else {
    spec = JSON.parse(raw) as OpenAPISpec;
  }

  const parsed = parseSpec(spec);
  const output = generateAll(parsed);

  if (dryRun) {
    for (const [filename, content] of Object.entries(output)) {
      console.log(`--- ${filename} ---`);
      console.log(content);
      console.log('');
    }
    return;
  }

  const resolvedOutDir = resolve(outDir);
  mkdirSync(resolvedOutDir, { recursive: true });

  for (const [filename, content] of Object.entries(output)) {
    const filePath = join(resolvedOutDir, filename);
    writeFileSync(filePath, content, 'utf-8');
    console.log(`  wrote ${filePath}`);
  }

  console.log(`\nGenerated ${Object.keys(output).length} files in ${resolvedOutDir}`);
}

function generateAll(parsed: ReturnType<typeof parseSpec>): Record<string, string> {
  const output: Record<string, string> = {};

  output['entities.ts'] = generateEntities(parsed.entities);
  output['store.ts'] = generateStore(parsed.entities);
  output['helpers.ts'] = generateHelpers(parsed.entities);

  for (const route of parsed.routes) {
    output[`routes/${route.filename}`] = generateRoutes(route);
  }

  return output;
}

main();
