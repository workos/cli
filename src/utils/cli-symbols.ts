/**
 * Centralized symbol and color definitions for CLI output.
 *
 * Provides consistent visual vocabulary across all CLI handlers.
 * Supports both Unicode and ASCII fallback for terminal compatibility.
 */
import chalk from 'chalk';
import { isUnicodeSupported } from './vendor/is-unicorn-supported.js';

const unicode = isUnicodeSupported();

export const symbols = {
  success: unicode ? '✓' : '+',
  error: unicode ? '✗' : 'x',
  warning: '!',
  info: unicode ? 'ℹ' : 'i',
  arrow: unicode ? '→' : '->',
  bullet: unicode ? '•' : '*',
  progressFilled: unicode ? '▓' : '#',
  progressEmpty: unicode ? '░' : '-',
} as const;

/**
 * Pre-styled output functions for consistent CLI formatting.
 * Uses chalk for coloring with appropriate symbols.
 */
export const styled = {
  /** Green checkmark with message */
  success: (text: string) => chalk.green(`${symbols.success} ${text}`),

  /** Red X with message */
  error: (text: string) => chalk.red(`${symbols.error} ${text}`),

  /** Yellow warning with message */
  warning: (text: string) => chalk.yellow(`${symbols.warning} ${text}`),

  /** Dim info text */
  info: (text: string) => chalk.dim(`${symbols.info} ${text}`),

  /** Cyan arrow for actions */
  action: (text: string) => chalk.cyan(`${symbols.arrow} ${text}`),

  /** Label with value, label is dimmed */
  label: (label: string, value: string) => `${chalk.dim(label)} ${value}`,

  /** Phase indicator with visual progress bar */
  phase: (num: number, total: number, name: string) => {
    const filled = symbols.progressFilled.repeat(num);
    const empty = symbols.progressEmpty.repeat(total - num);
    return `${chalk.cyan(filled)}${chalk.dim(empty)} ${name}`;
  },

  /** Bullet point for lists */
  bullet: (text: string) => `  ${symbols.bullet} ${text}`,
} as const;
