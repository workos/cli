/**
 * Fake terminal streams for rendering Ink in tests: a stdout that records
 * frames at a fixed size, and a stdin that feeds keypresses.
 */

import { EventEmitter } from 'node:events';

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export const stripAnsi = (s: string): string => s.replace(ANSI, '');

export class FakeStdout extends EventEmitter {
  readonly writes: string[] = [];
  isTTY = true;

  constructor(
    public columns = 80,
    public rows = 24,
  ) {
    super();
  }

  write = (chunk: string | Uint8Array): boolean => {
    this.writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };

  /**
   * The newest frame Ink drew (debug mode writes whole frames). Pass `match`
   * when other writes (escape codes, a transcript) share the stream.
   */
  lastFrame(match?: string): string {
    for (let i = this.writes.length - 1; i >= 0; i--) {
      if (match === undefined || stripAnsi(this.writes[i]).includes(match)) return this.writes[i];
    }
    return '';
  }

  resize(columns: number, rows: number): void {
    this.columns = columns;
    this.rows = rows;
    this.emit('resize');
  }

  output(): string {
    return this.writes.join('');
  }
}

export class FakeStdin extends EventEmitter {
  isTTY = true;
  rawMode = false;
  private queue: string[] = [];

  setRawMode(mode: boolean): this {
    this.rawMode = mode;
    return this;
  }
  setEncoding(): this {
    return this;
  }
  ref(): this {
    return this;
  }
  unref(): this {
    return this;
  }
  resume(): this {
    return this;
  }
  pause(): this {
    return this;
  }
  read(): string | null {
    return this.queue.shift() ?? null;
  }

  /** Type keys: '\r' enter, '\x1b' escape, '\x03' ctrl-c, '\x1b[B' down. */
  press(data: string): void {
    this.queue.push(data);
    this.emit('readable');
  }
}

export const KEY = {
  enter: '\r',
  escape: '\x1b',
  ctrlC: '\x03',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
} as const;

/** Poll until `check` passes (Ink renders asynchronously). */
export async function waitFor(check: () => boolean | void, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (check() !== false) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  if (lastError) throw lastError;
  throw new Error('waitFor timed out');
}
