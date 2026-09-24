/**
 * The WorkOS logomark as terminal cells, matching Arc's startup header.
 *
 * Arc rasterizes workos.svg at 22 cells wide and paints the covered cells with
 * a blurple background, because block glyphs can leave seams in some
 * terminals while cell backgrounds always fill the whole cell. This is that
 * raster, precomputed, so the binary ships no SVG renderer.
 */

export const LOGO_MASK = [
  '.....#######.####.....',
  '...########.#######...',
  '..########..########..',
  '.########....########.',
  '#######........#######',
  '#######........#######',
  '.########....########.',
  '..########..########..',
  '....######.#######....',
  '.....####.#######.....',
] as const;

export const LOGO_WIDTH = LOGO_MASK[0].length;

/** A horizontal run of cells that are all painted or all blank. */
export interface LogoRun {
  painted: boolean;
  text: string;
}

/** Full size: one terminal row per mask row, painted cells as spaces on blurple. */
export function logoRows(): LogoRun[][] {
  return LOGO_MASK.map((row) => {
    const runs: LogoRun[] = [];
    for (const cell of row) {
      const painted = cell === '#';
      const last = runs.at(-1);
      if (last && last.painted === painted) last.text += ' ';
      else runs.push({ painted, text: ' ' });
    }
    return runs;
  });
}

/**
 * Half height for short terminals: two mask rows per terminal row, drawn with
 * half-block glyphs in the brand color.
 */
export function compactLogoRows(): string[] {
  const out: string[] = [];
  for (let y = 0; y < LOGO_MASK.length; y += 2) {
    const top = LOGO_MASK[y];
    const bottom = LOGO_MASK[y + 1] ?? '.'.repeat(LOGO_WIDTH);
    let line = '';
    for (let x = 0; x < LOGO_WIDTH; x++) {
      const t = top[x] === '#';
      const b = bottom[x] === '#';
      line += t && b ? '█' : t ? '▀' : b ? '▄' : ' ';
    }
    out.push(line);
  }
  return out;
}
