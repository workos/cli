/** Colors and glyphs for the full-screen installer. */

/** WorkOS blurple, the same brand color Arc paints its logomark with. */
export const BLURPLE = '#6363F1';

export const colors = {
  brand: BLURPLE,
  success: 'green',
  warning: 'yellow',
  error: 'red',
  link: 'cyan',
  muted: 'gray',
} as const;

export const glyphs = {
  done: '✔',
  failed: '✗',
  pending: '○',
  skipped: '–',
  cancelled: '■',
  pointer: '›',
  bullet: '·',
  warning: '!',
  tip: '◆',
  next: '→',
} as const;

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** Smallest terminal the full-screen installer lays out in. */
export const MIN_COLUMNS = 80;
export const MIN_ROWS = 24;

/**
 * Below this the checklist doesn't fit beside the walkthrough; the walkthrough
 * keeps the room and the checklist becomes one progress line.
 */
export const SIDE_BY_SIDE_MIN_COLUMNS = 100;
export const SIDE_BY_SIDE_MIN_ROWS = 30;
