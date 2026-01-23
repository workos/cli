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

  /** Phase indicator: [1/5] Phase Name */
  phase: (num: number, total: number, name: string) => chalk.cyan(`[${num}/${total}] ${name}`),

  /** Bullet point for lists */
  bullet: (text: string) => `  ${symbols.bullet} ${text}`,
} as const;

/**
 * ASCII-only symbols for terminals without Unicode support.
 * Exported for testing or explicit ASCII mode.
 */
export const asciiSymbols = {
  success: '+',
  error: 'x',
  warning: '!',
  info: 'i',
  arrow: '->',
  bullet: '*',
} as const;
