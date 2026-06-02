import type chalk from 'chalk';
import { stripAnsii } from './string.js';

/** Visible (printable) width of a string, ignoring ANSI escape sequences. */
function visibleWidth(str: string): number {
  return stripAnsii(str).length;
}

/** Terminal width for stderr output, falling back to stdout then 80 columns. */
function terminalWidth(): number {
  return process.stderr.columns || process.stdout.columns || 80;
}

/**
 * Word-wrap a string to a maximum visible width, preserving ANSI color.
 *
 * chalk emits self-closing color spans (e.g. `\x1b[36m…\x1b[39m`), so each
 * colored fragment is atomic: we tokenize the input into whole colored spans
 * and plain words, then greedily pack tokens into lines measured by their
 * VISIBLE width. Because every token carries its own open+close codes, color
 * never bleeds across a line break onto the border or padding.
 *
 * A single token wider than `maxWidth` (rare — only a very narrow terminal vs.
 * a long unbroken word) overflows its own line rather than being split mid-span.
 * Such an overflow can push the rendered box border past the terminal width;
 * acceptable at standard widths. Note that a colored command produced by
 * `formatWorkOSCommand` can be long (e.g. `npx workos@latest telemetry opt-out`)
 * and stays a single unbreakable token by design.
 *
 * Limitation: a colored span is grouped atomically only when it is a single SGR
 * layer (one open code + one close code, as `chalk.cyan('…')` emits). Stacked
 * styles such as bold+color (`\x1b[1m\x1b[36m…\x1b[39m\x1b[22m`) or two adjacent
 * spans with no separating space are not guaranteed to stay on one line and may
 * leave a reset code mid-line. All current callers use single-color spans only.
 */
export function wrapAnsiAware(input: string, maxWidth: number): string[] {
  // A token is either: a full SGR-wrapped span (open code, content that may
  // contain spaces, close code), a run of non-space/non-escape characters
  // (a plain word), or a lone escape. Whitespace between tokens is dropped and
  // re-inserted as single separating spaces.
  const tokenRe = /\x1b\[[0-9;]*m[^\x1b]*?\x1b\[[0-9;]*m|[^\s\x1b]+|\x1b\[[0-9;]*m/g;
  const tokens = input.match(tokenRe) ?? [];

  const lines: string[] = [];
  let line = '';
  let lineWidth = 0;

  for (const token of tokens) {
    const tokenWidth = visibleWidth(token);
    if (lineWidth === 0) {
      line = token;
      lineWidth = tokenWidth;
    } else if (lineWidth + 1 + tokenWidth <= maxWidth) {
      line += ` ${token}`;
      lineWidth += 1 + tokenWidth;
    } else {
      lines.push(line);
      line = token;
      lineWidth = tokenWidth;
    }
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [''];
}

/**
 * Render a bordered box to stderr, wrapping to the terminal width.
 *
 * When the content fits on one line it renders exactly as a single-line box
 * (the historical behavior). When it would overflow the terminal, the content
 * is word-wrapped (ANSI-aware) and the box grows to multiple lines so the
 * border never breaks on a narrow terminal.
 */
export function renderStderrBox(inner: string, color: typeof chalk.yellow | typeof chalk.green): void {
  const cols = terminalWidth();
  const plainLen = visibleWidth(inner);

  // Fast path: content (including its own padding spaces) fits within the
  // terminal. Render the single-line box byte-for-byte as before.
  if (plainLen <= cols - 4) {
    const border = '─'.repeat(plainLen);
    console.error('');
    console.error(color(`  ┌${border}┐`));
    console.error(color('  │') + inner + color('│'));
    console.error(color(`  └${border}┘`));
    console.error('');
    return;
  }

  // Wrap path: trim the caller's outer padding, wrap to the available width,
  // then re-pad each line to a uniform inner width with one space of padding
  // on each side. Layout per line: "  │ " + text + " │" = text + 6 columns.
  const content = inner.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  const maxTextWidth = Math.max(1, cols - 6);
  const wrapped = wrapAnsiAware(content, maxTextWidth);

  // Snug the box to the longest wrapped line rather than the full terminal.
  const textWidth = Math.max(...wrapped.map(visibleWidth));
  const border = '─'.repeat(textWidth + 2);

  console.error('');
  console.error(color(`  ┌${border}┐`));
  for (const ln of wrapped) {
    const pad = ' '.repeat(Math.max(0, textWidth - visibleWidth(ln)));
    console.error(`${color('  │')} ${ln}${pad} ${color('│')}`);
  }
  console.error(color(`  └${border}┘`));
  console.error('');
}
