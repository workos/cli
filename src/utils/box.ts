import type chalk from 'chalk';
import { stripAnsii } from './string.js';

/**
 * Render a one-line bordered box to stderr.
 */
export function renderStderrBox(inner: string, color: typeof chalk.yellow | typeof chalk.green): void {
  const plainLen = stripAnsii(inner).length;
  const border = '─'.repeat(plainLen);
  console.error('');
  console.error(color(`  ┌${border}┐`));
  console.error(color('  │') + inner + color('│'));
  console.error(color(`  └${border}┘`));
  console.error('');
}
