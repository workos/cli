import chalk from 'chalk';
import { readFile } from 'node:fs/promises';
import { loadCatalog, endpointsByTag } from './catalog.js';
import { apiRequest } from './request.js';
import { resolveApiBaseUrl } from '../../lib/api-key.js';
import { exitWithError, isJsonMode, outputJson } from '../../utils/output.js';
import { isNonInteractiveEnvironment } from '../../utils/environment.js';
import { colorMethod, printResponse } from './format.js';

export { colorMethod } from './format.js';

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

export async function runApiInteractive(options?: { apiKey?: string }): Promise<void> {
  // Interactive mode is inherently human-oriented (clack prompts, preview text,
  // etc.). Refuse to enter it whenever JSON output was requested, regardless of
  // TTY status, so stdout stays machine-readable.
  if (isJsonMode()) {
    exitWithError({
      code: 'tty_required',
      message: 'Interactive mode is not available with --json. Provide an endpoint or use `workos api ls`.',
      details: {
        usage: ['workos api <endpoint>', 'workos api ls [filter]'],
      },
    });
  }

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
  await apiInteractive({ apiKey: options?.apiKey });
}

export async function runApiLs(filter?: string): Promise<void> {
  const catalog = await loadCatalog();
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

  if (endpoints.length === 0) {
    console.log(filter ? `No endpoints matching "${filter}".` : 'No endpoints found.');
    return;
  }

  const grouped = endpointsByTag(endpoints);

  for (const [tag, eps] of grouped) {
    console.log(`\n${chalk.bold(tag)}`);
    for (const ep of eps) {
      const method = colorMethod(ep.method).padEnd(18);
      console.log(`  ${method} ${ep.path}  ${chalk.dim(ep.summary)}`);
    }
  }
  console.log();
}

export async function runApiRequest(endpoint: string, options: ApiCommandOptions): Promise<void> {
  const body = await resolveBody(options);
  const hasBody = body !== undefined;
  const method = (options.method ?? (hasBody ? 'POST' : 'GET')).toUpperCase();
  const baseUrl = resolveApiBaseUrl();

  if (options.dryRun) {
    if (isJsonMode()) {
      let parsedBody: unknown;
      if (hasBody) {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          exitWithError({ code: 'invalid_json_body', message: 'Request body is not valid JSON.' });
        }
      }
      outputJson({
        dryRun: true,
        method,
        url: `${baseUrl}${normalizePath(endpoint)}`,
        body: parsedBody,
      });
    } else {
      console.log(`${chalk.dim('[dry-run]')} ${method} ${baseUrl}${normalizePath(endpoint)}`);
      if (hasBody) prettyPrint(body);
    }
    return;
  }

  if (MUTATING_METHODS.has(method) && !options.yes) {
    if (isJsonMode()) {
      exitWithError({
        code: 'confirmation_required',
        message: 'Mutating requests in JSON mode require --yes to keep stdout machine-readable.',
      });
    }
    if (isNonInteractiveEnvironment()) {
      console.error(`Refusing to ${method} ${endpoint} without --yes in a non-interactive environment.`);
      process.exit(1);
    }
    const clack = (await import('../../utils/clack.js')).default;
    console.log(`\n${chalk.yellow('About to')} ${method} ${endpoint}`);
    if (hasBody) prettyPrint(body);
    const ok = await clack.confirm({ message: 'Proceed?' });
    if (!ok || clack.isCancel(ok)) {
      process.exit(0);
    }
  }

  const response = await apiRequest({
    method,
    path: normalizePath(endpoint),
    apiKey: options.apiKey,
    body,
    baseUrl,
  });

  printResponse(response, { includeStatus: options.include });

  if (response.status >= 400) {
    process.exit(1);
  }
}

function normalizePath(path: string): string {
  if (!path.startsWith('/')) return `/${path}`;
  return path;
}

async function resolveBody(options: ApiCommandOptions): Promise<string | undefined> {
  if (options.data !== undefined) return options.data;
  if (options.file) {
    if (options.file === '-') {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      const stdinBody = Buffer.concat(chunks).toString('utf-8');
      if (stdinBody.length === 0) {
        exitWithError({
          code: 'empty_stdin_body',
          message:
            'Reading request body from stdin (--file -) yielded no data. Pipe data into the command or pass --data instead.',
        });
      }
      return stdinBody;
    }
    try {
      return await readFile(options.file, 'utf-8');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      exitWithError({
        code: 'file_read_error',
        message: `Could not read request body file "${options.file}": ${message}`,
      });
    }
  }
  return undefined;
}

function prettyPrint(jsonString: string): void {
  try {
    console.log(JSON.stringify(JSON.parse(jsonString), null, 2));
  } catch {
    console.log(jsonString);
  }
}
