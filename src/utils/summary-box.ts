import chalk from 'chalk';
import { isUnicodeSupported } from './vendor/is-unicorn-supported.js';
import { symbols, palette } from './cli-symbols.js';
import { compactLogoRows } from './logomark.js';
import type { CompletionData } from '../lib/events.js';

/** Max number of changed files listed in the success box before collapsing. */
const MAX_SUMMARY_FILES = 5;

/** Pre-built completion summaries, printed by the CLI adapter (and replayed after the full-screen view). */
export function renderCompletionSummary(success: boolean, summary?: string, completion?: CompletionData): string {
  if (success) {
    if (completion) {
      const files = completion.files;
      const shown: SummaryBoxItem[] = files.slice(0, MAX_SUMMARY_FILES).map((f) => ({ type: 'done', text: f }));
      if (files.length > MAX_SUMMARY_FILES) {
        shown.push({ type: 'done', text: `…and ${files.length - MAX_SUMMARY_FILES} more` });
      }
      const steps: SummaryBoxItem[] = completion.nextSteps.map((s) => ({ type: 'pending', text: s }));
      const setupPending = Boolean(completion.applicationSetup && !completion.applicationSetup.verified);
      return renderFlatSummary({
        // Code in, dashboard not yet: a warning, not a success.
        tone: setupPending ? 'warning' : 'success',
        title: setupPending ? 'App code installed; WorkOS setup required' : 'WorkOS AuthKit Installed',
        items: [...shown, ...steps],
        footer: completion.docsUrl,
      });
    }
    // Fallback: preserve the original static next-steps when no structured data is present.
    return renderFlatSummary({
      tone: 'success',
      title: 'WorkOS AuthKit Installed',
      items: [
        ...(summary ? [{ type: 'pending' as const, text: summary }] : []),
        { type: 'pending', text: 'Start dev server to test authentication' },
        { type: 'pending', text: 'Visit WorkOS Dashboard to manage users' },
      ],
      footer: 'https://workos.com/docs/authkit',
    });
  }
  return renderFlatSummary({
    tone: 'error',
    title: 'Installation Failed',
    items: summary ? [{ type: 'error', text: summary }] : [],
    footer: 'https://github.com/workos/cli/issues',
  });
}

export interface SummaryBoxItem {
  type: 'done' | 'pending' | 'error';
  text: string;
}

/** The outcome a summary reports. It sets the title's glyph and color. */
export type SummaryTone = 'success' | 'warning' | 'error';

export interface SummaryBoxOptions {
  tone: SummaryTone;
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

/** Outcome glyph and color for a summary's title line. */
const TONE: Record<SummaryTone, { glyph: string; color: (text: string) => string }> = {
  success: { glyph: unicode ? '✔' : symbols.success, color: palette.green },
  warning: { glyph: symbols.warning, color: palette.yellow },
  error: { glyph: symbols.error, color: palette.red },
};

/** The title line: outcome glyph and title in the outcome's color, bold. */
function toneTitle(tone: SummaryTone, title: string): { text: string; width: number } {
  const { glyph, color } = TONE[tone];
  return { text: chalk.bold(color(`${glyph} ${title}`)), width: glyph.length + 1 + title.length };
}

// ── Flat (de-boxed) rendering: the install opener + closer ──────────────────

const { accent, cyan: flatCyan } = palette;

/**
 * Flat glyphs matching the ui facade (green ✓ / accent ›). The title line
 * already carries the ✗, so an error detail under it is a red › rather than a
 * second ✗.
 */
const FLAT_ICONS: Record<SummaryBoxItem['type'], string> = {
  done: chalk.green('✓'),
  pending: accent('›'),
  error: chalk.red('›'),
};

/**
 * The install opener: the WorkOS logomark (the compact half-height raster the
 * full-screen installer uses on short terminals) beside the wordmark. Without
 * Unicode it collapses to one plain line.
 */
export function renderBrandMark(subtitle?: string, options: { unicode?: boolean } = {}): string {
  if (!(options.unicode ?? unicode)) {
    return `  ${chalk.bold(accent('WorkOS'))}${subtitle ? `  ${chalk.dim(subtitle)}` : ''}`;
  }
  const titleRow = 1;
  const subtitleRow = 2;
  return compactLogoRows()
    .map((row, i) => {
      if (i === titleRow) return `  ${accent(row)}   ${chalk.bold(accent('WorkOS'))}`;
      if (i === subtitleRow && subtitle) return `  ${accent(row)}   ${chalk.dim(subtitle)}`;
      return `  ${accent(row.trimEnd())}`;
    })
    .join('\n');
}

/**
 * The install closer: a title line that carries the outcome (✔ green,
 * ! yellow, ✗ red), then the checklist and footer, with no border.
 */
function renderFlatSummary(options: SummaryBoxOptions): string {
  const { tone, title, items = [], footer } = options;
  const out: string[] = [`  ${toneTitle(tone, title).text}`];
  for (const item of items) {
    // File paths (done) read better in cyan; next-step prose stays default weight.
    const text = item.type === 'done' ? flatCyan(item.text) : item.text;
    out.push(`  ${FLAT_ICONS[item.type]} ${text}`);
  }
  if (footer) out.push('', `  ${chalk.dim(footer)}`);
  return out.join('\n');
}

const MIN_WIDTH = 42;
// Item prefix "  X " = 4 visible chars before text
const ITEM_PREFIX_LEN = 4;
// Footer prefix "  " = 2 visible chars before text
const FOOTER_PREFIX_LEN = 2;
// Title prefix "  " = 2 visible chars before the outcome glyph
const TITLE_PREFIX_LEN = 2;

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
 * Render a summary box: a title line carrying the outcome, optional checklist
 * items, and an optional footer.
 */
export function renderSummaryBox(options: SummaryBoxOptions): string {
  const { tone, title, items = [], footer } = options;
  const heading = toneTitle(tone, title);

  // Cap box width to terminal width
  const termWidth = getTerminalWidth();
  const maxInner = Math.max(MIN_WIDTH - 2, termWidth - 2);

  // Compute ideal inner width from content
  const titleRowWidth = TITLE_PREFIX_LEN + heading.width;
  const itemWidths = items.map((item) => ITEM_PREFIX_LEN + item.text.length);
  const footerWidth = footer ? FOOTER_PREFIX_LEN + footer.length : 0;
  const idealInner = Math.max(titleRowWidth, ...itemWidths, footerWidth) + 1;

  const innerWidth = Math.min(Math.max(MIN_WIDTH - 2, idealInner), maxInner);
  const boxWidth = innerWidth + 2;

  // Available text width for items and footer (after prefix, before right padding + border)
  const itemTextMax = innerWidth - ITEM_PREFIX_LEN - 1;
  const footerTextMax = innerWidth - FOOTER_PREFIX_LEN - 1;

  const lines: string[] = [];
  const blank = `${BOX.v}${' '.repeat(innerWidth)}${BOX.v}`;

  // Top border, then the title line with breathing room
  lines.push(hLine(BOX.tl, BOX.tr, boxWidth));
  lines.push(blank);
  lines.push(`${BOX.v}${padRight(`  ${heading.text}`, titleRowWidth, innerWidth)}${BOX.v}`);

  // Items
  if (items.length > 0) {
    lines.push(blank);

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
  lines.push(blank);

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
