import { describe, it, expect } from 'vitest';
import { getLockArt, LOCK_WIDTH, type LockExpression } from './lock-art.js';

describe('lock-art', () => {
  const expressions: LockExpression[] = ['success', 'warning', 'error'];

  describe('getLockArt', () => {
    it.each(expressions)('returns 6 lines for %s expression', (expression) => {
      const lines = getLockArt(expression, false);
      expect(lines).toHaveLength(6);
    });

    it.each(expressions)('all lines have consistent width for %s', (expression) => {
      const lines = getLockArt(expression, false);
      for (const line of lines) {
        expect(line.length).toBe(LOCK_WIDTH);
      }
    });

    it('each expression has distinct face characters', () => {
      const [successLines, warningLines, errorLines] = expressions.map((e) => getLockArt(e, false));
      // Face row is index 3 (eyes) and 4 (mouth)
      expect(successLines[3]).not.toBe(warningLines[3]);
      expect(successLines[3]).not.toBe(errorLines[3]);
      expect(warningLines[3]).not.toBe(errorLines[3]);
    });

    it('success and warning share a closed shackle', () => {
      const success = getLockArt('success', false);
      const warning = getLockArt('warning', false);
      expect(success[0]).toBe(warning[0]);
      expect(success[1]).toBe(warning[1]);
    });

    it('error has an open shackle (right side disconnected)', () => {
      const success = getLockArt('success', false);
      const error = getLockArt('error', false);
      expect(error[0]).toBe(success[0]); // top curve same
      expect(error[1]).not.toBe(success[1]); // right bar removed
    });

    it('colored and uncolored return same number of lines', () => {
      const colored = getLockArt('success', true);
      const raw = getLockArt('success', false);
      expect(colored).toHaveLength(raw.length);
    });

    it('returns uncolored lines when color is false', () => {
      const lines = getLockArt('success', false);
      for (const line of lines) {
        // No ANSI escape codes (they start with \x1B)
        expect(line).not.toMatch(/\x1B/);
      }
    });
  });
});
