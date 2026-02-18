import { describe, it, expect } from 'vitest';
import { renderSummaryBox, type SummaryBoxItem } from './summary-box.js';

// Simple ANSI code stripper (avoids needing strip-ansi as a dependency)
function strip(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

describe('summary-box', () => {
  describe('renderSummaryBox', () => {
    it('renders a box with title and no items', () => {
      const result = strip(renderSummaryBox({
        expression: 'success',
        title: 'All Good',
      }));
      expect(result).toContain('All Good');
      expect(result).toMatch(/[┌+]/);
      expect(result).toMatch(/[└+]/);
    });

    it('includes all checklist items', () => {
      const items: SummaryBoxItem[] = [
        { type: 'done', text: 'Middleware configured' },
        { type: 'done', text: 'Auth routes created' },
        { type: 'pending', text: 'Set cookie domain' },
        { type: 'error', text: 'Missing API key' },
      ];
      const result = strip(renderSummaryBox({
        expression: 'warning',
        title: 'Issues Found',
        items,
      }));
      expect(result).toContain('Middleware configured');
      expect(result).toContain('Auth routes created');
      expect(result).toContain('Set cookie domain');
      expect(result).toContain('Missing API key');
    });

    it('renders footer with divider', () => {
      const result = strip(renderSummaryBox({
        expression: 'success',
        title: 'Done',
        footer: 'pnpm dev',
      }));
      expect(result).toContain('pnpm dev');
      // Mid-border should be present
      expect(result).toMatch(/[├+]/);
    });

    it('omits mid-border when no footer provided', () => {
      const result = strip(renderSummaryBox({
        expression: 'success',
        title: 'Done',
      }));
      const lines = result.split('\n');
      const hasMidBorder = lines.some((l) => /^├/.test(l));
      expect(hasMidBorder).toBe(false);
    });

    it('renders lock character in the box', () => {
      const result = strip(renderSummaryBox({
        expression: 'success',
        title: 'Test',
      }));
      // Should contain parts of the lock body
      expect(result).toMatch(/[╔+]/);
      expect(result).toMatch(/[╚+]/);
    });

    it('renders all three expressions without error', () => {
      for (const expression of ['success', 'warning', 'error'] as const) {
        expect(() =>
          renderSummaryBox({ expression, title: `Test ${expression}` }),
        ).not.toThrow();
      }
    });

    it('handles empty items array', () => {
      const result = renderSummaryBox({
        expression: 'success',
        title: 'Clean',
        items: [],
      });
      expect(result).toBeDefined();
      expect(strip(result)).toContain('Clean');
    });

    it('handles many items', () => {
      const items: SummaryBoxItem[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'done' as const,
        text: `Item ${i + 1}`,
      }));
      const result = strip(renderSummaryBox({
        expression: 'success',
        title: 'Many Items',
        items,
      }));
      expect(result).toContain('Item 1');
      expect(result).toContain('Item 10');
    });

    it('box lines are consistent width', () => {
      const result = strip(renderSummaryBox({
        expression: 'success',
        title: 'Width Test',
        items: [
          { type: 'done', text: 'Short' },
          { type: 'pending', text: 'A longer item here' },
        ],
        footer: 'Some footer text',
      }));
      const lines = result.split('\n');
      const firstLineWidth = lines[0].length;
      for (const line of lines) {
        expect(line.length).toBe(firstLineWidth);
      }
    });
  });
});
