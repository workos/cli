#!/usr/bin/env tsx
/**
 * Dev script: refresh the vendored Management catalog snapshot from a local
 * `workos` monorepo checkout, so the snapshot does not rot by hand.
 *
 * Usage:
 *   pnpm catalog:vendor                     # default sibling ../workos
 *   pnpm catalog:vendor --monorepo <path>   # explicit monorepo root
 *   WORKOS_MONOREPO=<path> pnpm catalog:vendor
 *
 * Resolves <monorepo>/packages/api/src/mcp/generated/mcp-catalog.generated.json,
 * validates that it parses and has at least one operation, then writes
 * src/catalog/mcp-catalog.snapshot.json. Fails loudly if the source is missing
 * or empty so a bad refresh can't silently empty the snapshot.
 *
 * This is the MVP stand-in for the (deferred) CI drift gate; it requires the
 * monorepo locally and is not run in CI.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_RELATIVE = 'packages/api/src/mcp/generated/mcp-catalog.generated.json';
const SNAPSHOT_RELATIVE = '../src/catalog/mcp-catalog.snapshot.json';

interface ParsedArgs {
  monorepo: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let monorepo: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--monorepo') {
      monorepo = args[i + 1];
      i++;
    } else if (arg?.startsWith('--monorepo=')) {
      monorepo = arg.slice('--monorepo='.length);
    }
  }
  monorepo ??= process.env.WORKOS_MONOREPO ?? '../workos';
  return { monorepo: resolve(monorepo) };
}

function fail(message: string): never {
  console.error(`vendor-catalog: ${message}`);
  process.exit(1);
}

function main(): void {
  const { monorepo } = parseArgs(process.argv);
  const sourcePath = join(monorepo, SOURCE_RELATIVE);

  if (!existsSync(sourcePath)) {
    fail(
      `source catalog not found at ${sourcePath}\n` +
        `Point at your monorepo with --monorepo <path> or WORKOS_MONOREPO=<path>.`,
    );
  }

  let raw: string;
  try {
    raw = readFileSync(sourcePath, 'utf8');
  } catch (error) {
    fail(`failed to read ${sourcePath}: ${(error as Error).message}`);
  }

  let data: { operations?: Record<string, unknown> };
  try {
    data = JSON.parse(raw);
  } catch (error) {
    fail(`source catalog is not valid JSON: ${(error as Error).message}`);
  }

  const operationCount = Object.keys(data.operations ?? {}).length;
  if (operationCount === 0) {
    fail(`source catalog has zero operations — refusing to write an empty snapshot`);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const snapshotPath = resolve(here, SNAPSHOT_RELATIVE);
  // Re-serialize from the parsed object for stable, validated formatting.
  writeFileSync(snapshotPath, `${JSON.stringify(data, null, 2)}\n`);

  console.log(`vendor-catalog: wrote ${operationCount} operations to ${snapshotPath}`);
  console.log(`  source: ${sourcePath}`);
}

main();
