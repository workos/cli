import { readFile } from 'node:fs/promises';
import { exitWithError } from './output.js';

export async function resolveInputBody(options: { data?: string; file?: string }): Promise<string | undefined> {
  if (options.data !== undefined) return options.data;
  if (!options.file) return undefined;

  if (options.file === '-') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks).toString('utf-8');
    if (body.length === 0) {
      exitWithError({
        code: 'empty_stdin_body',
        message:
          'Reading request body from stdin (--file -) yielded no data. Pipe data into the command or pass --data instead.',
      });
    }
    return body;
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
