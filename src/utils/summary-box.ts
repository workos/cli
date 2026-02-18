import chalk from 'chalk';
import { isUnicodeSupported } from './vendor/is-unicorn-supported.js';
import { type LockExpression, getLockArt, LOCK_WIDTH } from './lock-art.js';
import { symbols } from './cli-symbols.js';

/** Pre-built completion summaries shared by CLI and Dashboard adapters. */
export function renderCompletionSummary(success: boolean, summary?: string): string {
  if (success) {
    return renderSummaryBox({
      expression: 'success',
      title: 'WorkOS AuthKit Installed',
      items: [
        { type: 'pending', text: 'Start dev server to test authentication' },
        { type: 'pending', text: 'Visit WorkOS Dashboard to manage users' },
      ],
      footer: 'https://workos.com/docs/authkit',
    });
  }
  return renderSummaryBox({
    expression: 'error',
    title: 'Installation Failed',
    items: summary ? [{ type: 'error', text: summary }] : [],
    footer: 'https://github.com/workos/installer/issues',
  });
}

export interface SummaryBoxItem {
  type: 'done' | 'pending' | 'error';
  text: string;
}

export interface SummaryBoxOptions {
  expression: LockExpression;
  title: string;
  items?: SummaryBoxItem[];
  footer?: string;
}

const unicode = isUnicodeSupported();

const BOX = unicode
  ? { tl: '┌', tr: '┐', bl: '└', br: '┘', h: '─', v: '│', ml: '├', mr: '┤' }
  : { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', ml: '+', mr: '+' };

const ITEM_ICONS: Record<SummaryBoxItem['type'], string> = {
  done: chalk.green(symbols.success),
  pending: chalk.cyan(symbols.arrow),
  error: chalk.red(symbols.error),
};

const MIN_WIDTH = 42;
// Item prefix "  X " = 4 visible chars before text
const ITEM_PREFIX_LEN = 4;
// Footer prefix "  " = 2 visible chars before text
const FOOTER_PREFIX_LEN = 2;

function hLine(left: string, right: string, width: number): string {
  return `${left}${BOX.h.repeat(width - 2)}${right}`;
}

function padRight(text: string, visibleLen: number, targetLen: number): string {
  const padding = Math.max(0, targetLen - visibleLen);
  return text + ' '.repeat(padding);
}

/** Word-wrap text to fit within maxLen, returning multiple lines. */
function wrapText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const words = text.split(' ');
  const wrapped: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLen && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) wrapped.push(current);
  return wrapped;
}

function getTerminalWidth(): number {
  return process.stdout.columns || 80;
}

/**
 * Render a branded summary box with the WorkOS lock character,
 * a title, optional checklist items, and an optional footer.
 */
export function renderSummaryBox(options: SummaryBoxOptions): string {
  const { expression, title, items = [], footer } = options;

  const lockColored = getLockArt(expression, true);
  const lockRaw = getLockArt(expression, false);
  const lockLines = lockColored.length;

  // " " + lock + "  " = lock column width
  const lockColWidth = LOCK_WIDTH + 3;

  // Cap box width to terminal width
  const termWidth = getTerminalWidth();
  // innerWidth must fit: lock+title, items, footer — but capped to terminal
  const maxInner = Math.max(MIN_WIDTH - 2, termWidth - 2);

  // Compute ideal inner width from content
  const titleRowWidth = lockColWidth + title.length;
  const itemWidths = items.map((item) => ITEM_PREFIX_LEN + item.text.length);
  const footerWidth = footer ? FOOTER_PREFIX_LEN + footer.length : 0;
  const idealInner = Math.max(titleRowWidth, ...itemWidths, footerWidth) + 1;

  const innerWidth = Math.min(Math.max(MIN_WIDTH - 2, idealInner), maxInner);
  const boxWidth = innerWidth + 2;

  // Available text width for items and footer (after prefix, before right padding + border)
  const itemTextMax = innerWidth - ITEM_PREFIX_LEN - 1;
  const footerTextMax = innerWidth - FOOTER_PREFIX_LEN - 1;

  const lines: string[] = [];

  // Top border
  lines.push(hLine(BOX.tl, BOX.tr, boxWidth));

  // Lock + title rows
  const titleLineIndex = 3;
  for (let i = 0; i < lockLines; i++) {
    const lockPart = ` ${lockColored[i]}  `;
    const lockPartRaw = ` ${lockRaw[i]}  `;
    let rightPart: string;
    let rightPartLen: number;
    if (i === titleLineIndex) {
      rightPart = chalk.bold(title);
      rightPartLen = title.length;
    } else {
      rightPart = '';
      rightPartLen = 0;
    }
    const row = BOX.v + padRight(lockPart + rightPart, lockPartRaw.length + rightPartLen, innerWidth) + BOX.v;
    lines.push(row);
  }

  // Items
  if (items.length > 0) {
    lines.push(`${BOX.v}${' '.repeat(innerWidth)}${BOX.v}`);

    for (const item of items) {
      const icon = ITEM_ICONS[item.type];
      const wrappedLines = wrapText(item.text, itemTextMax);
      // First line gets the icon
      const first = `  ${icon} ${wrappedLines[0]}`;
      const firstLen = ITEM_PREFIX_LEN + wrappedLines[0].length;
      lines.push(`${BOX.v}${padRight(first, firstLen, innerWidth)}${BOX.v}`);
      // Continuation lines are indented to align with text after icon
      for (let j = 1; j < wrappedLines.length; j++) {
        const cont = `    ${wrappedLines[j]}`;
        const contLen = 4 + wrappedLines[j].length;
        lines.push(`${BOX.v}${padRight(cont, contLen, innerWidth)}${BOX.v}`);
      }
    }
  }

  // Footer
  if (footer) {
    lines.push(hLine(BOX.ml, BOX.mr, boxWidth));
    const wrappedFooter = wrapText(footer, footerTextMax);
    for (const fLine of wrappedFooter) {
      const content = `  ${chalk.dim(fLine)}`;
      const visibleLen = FOOTER_PREFIX_LEN + fLine.length;
      lines.push(`${BOX.v}${padRight(content, visibleLen, innerWidth)}${BOX.v}`);
    }
  }

  // Bottom border
  lines.push(hLine(BOX.bl, BOX.br, boxWidth));

  return lines.join('\n');
}
