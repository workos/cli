import chalk from 'chalk';
import { isJsonMode, outputJson } from '../../utils/output.js';
import type { ApiResponse } from './request.js';

export function colorMethod(method: string): string {
  switch (method) {
    case 'GET':
      return chalk.green(method);
    case 'POST':
      return chalk.blue(method);
    case 'PUT':
    case 'PATCH':
      return chalk.yellow(method);
    case 'DELETE':
      return chalk.red(method);
    default:
      return method;
  }
}

export function printResponse(
  response: ApiResponse,
  { includeStatus = false }: { includeStatus?: boolean } = {},
): void {
  if (includeStatus) {
    console.log(chalk.dim(`HTTP ${response.status}`));
    response.headers.forEach((value, key) => {
      console.log(chalk.dim(`${key}: ${value}`));
    });
    console.log();
  }

  if (isJsonMode()) {
    outputJson(response.body);
  } else if (typeof response.body === 'object' && response.body !== null) {
    console.log(JSON.stringify(response.body, null, 2));
  } else {
    console.log(response.rawBody);
  }
}
