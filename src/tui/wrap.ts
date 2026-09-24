/**
 * Word wrapping for walkthrough entries. The walkthrough shows the newest
 * entries that fit its height, so it needs exact line counts rather than
 * letting the terminal wrap.
 */

/** Display width in cells. Content is plain text, so code points are enough. */
const stringWidth = (s: string): number => [...s].length;

/** Break `text` into lines no wider than `width`, splitting long words. */
export function wrapText(text: string, width: number): string[] {
  const max = Math.max(1, width);
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let rest = word;
      while (stringWidth(rest) > max) {
        if (line) {
          lines.push(line);
          line = '';
        }
        const chars = [...rest];
        lines.push(chars.slice(0, max).join(''));
        rest = chars.slice(max).join('');
      }
      if (!rest) continue;
      const candidate = line ? `${line} ${rest}` : rest;
      if (stringWidth(candidate) <= max) line = candidate;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * The newest items whose wrapped lines fit in `height`, oldest first. The
 * newest item is always included (clipped to `height` lines) so the latest
 * news is never hidden.
 */
export function fitNewest<T>(
  items: readonly T[],
  lines: (item: T) => string[],
  height: number,
): Array<{ item: T; lines: string[] }> {
  const out: Array<{ item: T; lines: string[] }> = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const wrapped = lines(items[i]);
    if (used + wrapped.length > height) {
      if (out.length === 0) out.push({ item: items[i], lines: wrapped.slice(0, Math.max(1, height)) });
      break;
    }
    out.push({ item: items[i], lines: wrapped });
    used += wrapped.length;
  }
  return out.reverse();
}
