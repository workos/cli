#!/usr/bin/env tsx
/**
 * Coverage checker: compares the WorkOS OpenAPI spec against the emulator's
 * registered routes to find missing or extra endpoints.
 *
 * Usage:
 *   pnpm check:coverage path/to/openapi.yaml
 *   pnpm check:coverage ~/Developer/workos/packages/api/open-api-spec.yaml
 *
 * Reports:
 *   - Spec endpoints missing from the emulator
 *   - Emulator endpoints not in the spec (custom/internal)
 *   - Coverage percentage
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, extname, join } from 'node:path';
import YAML from 'yaml';

// ---------------------------------------------------------------------------
// Parse OpenAPI spec endpoints
// ---------------------------------------------------------------------------

interface SpecEndpoint {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  tags: string[];
}

function parseOpenApiEndpoints(specPath: string): SpecEndpoint[] {
  const raw = readFileSync(specPath, 'utf-8');
  const ext = extname(specPath).toLowerCase();
  const spec = ext === '.yaml' || ext === '.yml' ? YAML.parse(raw) : JSON.parse(raw);

  const endpoints: SpecEndpoint[] = [];
  const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;

  for (const [path, item] of Object.entries(spec.paths ?? {}) as [string, any][]) {
    for (const method of methods) {
      const op = item[method];
      if (!op) continue;

      // Normalize OpenAPI path params {id} → :id
      const normalizedPath = path.replace(/\{([^}]+)\}/g, ':$1');

      endpoints.push({
        method: method.toUpperCase(),
        path: normalizedPath,
        operationId: op.operationId,
        summary: op.summary,
        tags: op.tags ?? [],
      });
    }
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Parse emulator registered routes from source files
// ---------------------------------------------------------------------------

interface EmulatorEndpoint {
  method: string;
  path: string;
  file: string;
  line: number;
}

function parseEmulatorEndpoints(): EmulatorEndpoint[] {
  const routesDir = resolve('src/emulate/workos/routes');
  const serverFile = resolve('src/emulate/core/server.ts');
  const endpoints: EmulatorEndpoint[] = [];

  const routePattern = /app\.(get|post|put|patch|delete)\('([^']+)'/g;

  const filesToScan: string[] = [];

  // Collect route files
  if (existsSync(routesDir)) {
    for (const file of readdirSync(routesDir)) {
      if (file.endsWith('.ts') && !file.endsWith('.spec.ts')) {
        filesToScan.push(join(routesDir, file));
      }
    }
  }

  // Also scan server.ts for JWKS and other direct routes
  if (existsSync(serverFile)) {
    filesToScan.push(serverFile);
  }

  for (const filePath of filesToScan) {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      routePattern.lastIndex = 0;
      let match;
      while ((match = routePattern.exec(lines[i])) !== null) {
        endpoints.push({
          method: match[1].toUpperCase(),
          path: match[2],
          file: filePath.replace(resolve('.') + '/', ''),
          line: i + 1,
        });
      }
    }
  }

  return endpoints;
}

// ---------------------------------------------------------------------------
// Normalize paths for comparison
// ---------------------------------------------------------------------------

/** Normalize path params to a canonical form for matching.
 *  e.g., :id, :orgId, :organization_id all become :param in the same position */
function normalizePath(path: string): string {
  return path
    .replace(/:[a-zA-Z_]+/g, ':param')
    .replace(/\/+$/, '')
    .toLowerCase();
}

function routeKey(method: string, path: string): string {
  return `${method} ${normalizePath(path)}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const specPath = process.argv[2];
  if (!specPath) {
    console.error('Usage: check-coverage <openapi-spec-path>');
    console.error('  e.g.: pnpm check:coverage ~/Developer/workos/packages/api/open-api-spec.yaml');
    process.exit(1);
  }

  const resolvedSpec = resolve(specPath);
  if (!existsSync(resolvedSpec)) {
    console.error(`Spec file not found: ${resolvedSpec}`);
    process.exit(1);
  }

  const specEndpoints = parseOpenApiEndpoints(resolvedSpec);
  const emulatorEndpoints = parseEmulatorEndpoints();

  // Build lookup maps
  const specMap = new Map<string, SpecEndpoint>();
  for (const ep of specEndpoints) {
    specMap.set(routeKey(ep.method, ep.path), ep);
  }

  const emulatorMap = new Map<string, EmulatorEndpoint>();
  for (const ep of emulatorEndpoints) {
    emulatorMap.set(routeKey(ep.method, ep.path), ep);
  }

  // Find gaps
  const missing: SpecEndpoint[] = [];
  const covered: SpecEndpoint[] = [];
  for (const [key, ep] of specMap) {
    if (emulatorMap.has(key)) {
      covered.push(ep);
    } else {
      missing.push(ep);
    }
  }

  const extra: EmulatorEndpoint[] = [];
  for (const [key, ep] of emulatorMap) {
    if (!specMap.has(key)) {
      extra.push(ep);
    }
  }

  // Group missing by tag
  const missingByTag = new Map<string, SpecEndpoint[]>();
  for (const ep of missing) {
    const tag = ep.tags[0] ?? 'untagged';
    if (!missingByTag.has(tag)) missingByTag.set(tag, []);
    missingByTag.get(tag)!.push(ep);
  }

  // Report
  const total = specEndpoints.length;
  const coveredCount = covered.length;
  const pct = total > 0 ? ((coveredCount / total) * 100).toFixed(1) : '0';

  console.log('');
  console.log('=== Emulator API Coverage Report ===');
  console.log('');
  console.log(`  Spec endpoints:     ${total}`);
  console.log(`  Emulator endpoints: ${emulatorEndpoints.length}`);
  console.log(`  Covered:            ${coveredCount}/${total} (${pct}%)`);
  console.log(`  Missing:            ${missing.length}`);
  console.log(`  Extra (emulator-only): ${extra.length}`);
  console.log('');

  if (missing.length > 0) {
    console.log('--- Missing from emulator ---');
    console.log('');
    for (const [tag, eps] of [...missingByTag.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      console.log(`  [${tag}]`);
      for (const ep of eps) {
        const desc = ep.summary ? ` — ${ep.summary}` : '';
        console.log(`    ${ep.method.padEnd(6)} ${ep.path}${desc}`);
      }
      console.log('');
    }
  }

  if (extra.length > 0) {
    console.log('--- Emulator-only (not in spec) ---');
    console.log('');
    for (const ep of extra.sort((a, b) => a.path.localeCompare(b.path))) {
      console.log(`    ${ep.method.padEnd(6)} ${ep.path}  (${ep.file}:${ep.line})`);
    }
    console.log('');
  }

  if (missing.length === 0) {
    console.log('Full coverage — all spec endpoints are implemented.');
    console.log('');
  }

  // Exit 1 if there are missing endpoints (useful for CI later)
  process.exit(missing.length > 0 ? 1 : 0);
}

main();
