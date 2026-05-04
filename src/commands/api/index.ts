/**
 * `workos api` — generic authenticated API gateway.
 *
 * Modes:
 *   workos api                    — interactive request builder (TTY only)
 *   workos api ls [filter]        — list endpoints from the embedded OpenAPI spec
 *   workos api <endpoint> [opts]  — make an authenticated request
 */

import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import { loadCatalog, endpointsByTag } from './catalog.js';
import { apiRequest } from './request.js';
import { resolveApiBaseUrl } from '../../lib/api-key.js';
import { isJsonMode, outputJson } from '../../utils/output.js';
import { isNonInteractiveEnvironment } from '../../utils/environment.js';

export interface ApiCommandOptions {
  method?: string;
  data?: string;
  file?: string;
  include?: boolean;
  apiKey?: string;
  dryRun?: boolean;
  yes?: boolean;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ── interactive ───────────────────────────────────────────────────────

export async function runApiInteractive(): Promise<void> {
  if (isNonInteractiveEnvironment()) {
    console.log(
      'Interactive mode requires a TTY.\n\n' +
        'Usage:\n' +
        '  workos api <endpoint>        Make an API request\n' +
        '  workos api ls [filter]       List available endpoints\n' +
        '\nExample:\n' +
        '  workos api /user_management/users\n' +
        '  workos api ls users',
    );
    return;
  }

  const { apiInteractive } = await import('./interactive.js');
  await apiInteractive();
}

// ── ls ─────────────────────────────────────────────────────────────────

export function runApiLs(filter?: string): void {
  const catalog = loadCatalog();
  let endpoints = catalog.endpoints;

  if (filter) {
    const lower = filter.toLowerCase();
    endpoints = endpoints.filter(
      (e) =>
        e.path.toLowerCase().includes(lower) ||
        e.tag.toLowerCase().includes(lower) ||
        e.summary.toLowerCase().includes(lower) ||
        e.operationId.toLowerCase().includes(lower),
    );
  }

  if (endpoints.length === 0) {
    if (isJsonMode()) {
      outputJson({ data: [] });
    } else {
      console.log(filter ? `No endpoints matching "${filter}".` : 'No endpoints found.');
    }
    return;
  }

  if (isJsonMode()) {
    outputJson({
      data: endpoints.map((e) => ({
        method: e.method,
        path: e.path,
        summary: e.summary,
        tag: e.tag,
      })),
    });
    return;
  }

  const grouped = endpointsByTag({ endpoints, tags: [...new Set(endpoints.map((e) => e.tag))].sort() });

  for (const [tag, eps] of grouped) {
    console.log(`\n${chalk.bold(tag)}`);
    for (const ep of eps) {
      const method = colorMethod(ep.method).padEnd(18);
      console.log(`  ${method} ${ep.path}  ${chalk.dim(ep.summary)}`);
    }
  }
  console.log();
}

// ── request ────────────────────────────────────────────────────────────

export async function runApiRequest(endpoint: string, options: ApiCommandOptions): Promise<void> {
  const body = await resolveBody(options);
  const method = (options.method ?? (body ? 'POST' : 'GET')).toUpperCase();
  const baseUrl = resolveApiBaseUrl();

  if (options.dryRun) {
    if (isJsonMode()) {
      outputJson({
        dryRun: true,
        method,
        url: `${baseUrl}${normalizePath(endpoint)}`,
        body: body ? JSON.parse(body) : undefined,
      });
    } else {
      console.log(`${chalk.dim('[dry-run]')} ${method} ${baseUrl}${normalizePath(endpoint)}`);
      if (body) prettyPrint(body);
    }
    return;
  }

  if (MUTATING_METHODS.has(method) && !options.yes && !isNonInteractiveEnvironment()) {
    const clack = (await import('../../utils/clack.js')).default;
    console.log(`\n${chalk.yellow('About to')} ${method} ${endpoint}`);
    if (body) prettyPrint(body);
    const ok = await clack.confirm({ message: 'Proceed?' });
    if (!ok || clack.isCancel(ok)) {
      process.exit(0);
    }
  }

  const response = await apiRequest({
    method,
    path: normalizePath(endpoint),
    apiKey: options.apiKey,
    body: body ?? undefined,
    baseUrl,
  });

  if (options.include) {
    printHeaders(response.status, response.headers);
  }

  if (isJsonMode()) {
    outputJson(response.body);
  } else if (typeof response.body === 'object' && response.body !== null) {
    console.log(JSON.stringify(response.body, null, 2));
  } else {
    console.log(response.rawBody);
  }

  if (response.status >= 400) {
    process.exit(1);
  }
}

// ── helpers ────────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

async function resolveBody(options: ApiCommandOptions): Promise<string | null> {
  if (options.data) return options.data;
  if (options.file) {
    if (options.file === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf-8');
    }
    return readFileSync(options.file, 'utf-8');
  }
  return null;
}

function prettyPrint(jsonString: string): void {
  try {
    console.log(JSON.stringify(JSON.parse(jsonString), null, 2));
  } catch {
    console.log(jsonString);
  }
}

function printHeaders(status: number, headers: Headers): void {
  console.log(chalk.dim(`HTTP ${status}`));
  headers.forEach((value, key) => {
    console.log(chalk.dim(`${key}: ${value}`));
  });
  console.log();
}

export function colorMethod(method: string): string {
  switch (method) {
    case 'GET':
      return chalk.green(method);
    case 'POST':
      return chalk.blue(method);
    case 'PUT':
      return chalk.yellow(method);
    case 'PATCH':
      return chalk.yellow(method);
    case 'DELETE':
      return chalk.red(method);
    default:
      return method;
  }
}
