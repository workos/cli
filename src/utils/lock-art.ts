import chalk from 'chalk';
import { isUnicodeSupported } from './vendor/is-unicorn-supported.js';

export type LockExpression = 'success' | 'warning' | 'error';

const unicode = isUnicodeSupported();

// prettier-ignore
const UNICODE_LOCKS: Record<LockExpression, string[]> = {
  success: [
    ' ╭─╮ ',
    ' │ │ ',
    '╔╧═╧╗',
    '║◠ ◠║',
    '║ ▽ ║',
    '╚═══╝',
  ],
  warning: [
    ' ╭─╮ ',
    ' │ │ ',
    '╔╧═╧╗',
    '║• •║',
    '║ ─ ║',
    '╚═══╝',
  ],
  error: [
    ' ╭─╮ ',
    ' │ │ ',
    '╔╧══╗',
    '║× ×║',
    '║ △ ║',
    '╚═══╝',
  ],
};

// prettier-ignore
const ASCII_LOCKS: Record<LockExpression, string[]> = {
  success: [
    ' .-. ',
    ' | | ',
    '+---+',
    '|^ ^|',
    '| v |',
    '+---+',
  ],
  warning: [
    ' .-. ',
    ' | | ',
    '+---+',
    '|. .|',
    '| - |',
    '+---+',
  ],
  error: [
    ' .-. ',
    ' |   ',
    '+---+',
    '|x x|',
    '| ^ |',
    '+---+',
  ],
};

const COLORS: Record<LockExpression, (text: string) => string> = {
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
};

/** Width of each lock art line (all lines are the same width). */
export const LOCK_WIDTH = 5;

/**
 * Returns the WorkOS lock character as an array of lines.
 * Each line is the same width for easy side-by-side composition.
 */
export function getLockArt(expression: LockExpression, color = true): string[] {
  const variants = unicode ? UNICODE_LOCKS : ASCII_LOCKS;
  const lines = variants[expression];
  if (!color) return lines;
  const colorFn = COLORS[expression];
  return lines.map((line) => colorFn(line));
}
