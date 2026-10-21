/** Terminal control for the full-screen installer. */

import { writeSync } from 'node:fs';

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const CLEAR_SCREEN = '\x1b[2J';
const CURSOR_HOME = '\x1b[H';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const RESET_ATTRS = '\x1b[0m';

export const ENTER_FULLSCREEN = ENTER_ALT_SCREEN + CLEAR_SCREEN + CURSOR_HOME + HIDE_CURSOR;
export const LEAVE_FULLSCREEN = RESET_ATTRS + SHOW_CURSOR + LEAVE_ALT_SCREEN;

/**
 * Write synchronously. Restoring the terminal happens in `process.on('exit')`,
 * where queued async writes never flush, so the real stdout gets a direct
 * `writeSync`. Other streams (tests) fall back to `write`.
 */
export function writeNow(stream: NodeJS.WriteStream, text: string): void {
  if (!text) return;
  if (stream === process.stdout || stream === process.stderr) {
    try {
      writeSync(stream === process.stdout ? 1 : 2, text);
      return;
    } catch {
      // EAGAIN on a non-blocking pipe: fall through to the async write.
    }
  }
  stream.write(text);
}

/** Put stdin back to cooked mode so the shell works normally after we exit. */
export function releaseStdin(stdin: NodeJS.ReadStream): void {
  try {
    if (stdin.isTTY && typeof stdin.setRawMode === 'function') stdin.setRawMode(false);
    stdin.pause?.();
  } catch {
    // Already closed.
  }
}
