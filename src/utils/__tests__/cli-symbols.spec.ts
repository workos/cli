import { describe, it, expect, vi, afterEach } from 'vitest';

const originalTERM = process.env.TERM;

describe('cli-symbols', () => {
  afterEach(() => {
    // Restore env after each test
    if (originalTERM !== undefined) {
      process.env.TERM = originalTERM;
    } else {
      delete process.env.TERM;
    }
    vi.resetModules();
  });

  describe('symbols', () => {
    it('exports unicode symbols on unicode-capable terminals', async () => {
      // Non-Windows, non-Linux console = Unicode supported
      process.env.TERM = 'xterm-256color';

      const { symbols } = await import('../cli-symbols.js');

      // On macOS/Linux with normal terminal, should be Unicode
      expect(symbols.success).toBe('✓');
      expect(symbols.error).toBe('✗');
      expect(symbols.warning).toBe('!');
      expect(symbols.info).toBe('ℹ');
      expect(symbols.arrow).toBe('→');
      expect(symbols.bullet).toBe('•');
    });

    it('exports warning symbol as ! (same in both modes)', async () => {
      const { symbols } = await import('../cli-symbols.js');
      expect(symbols.warning).toBe('!');
    });
  });

  describe('styled', () => {
    it('styled.success produces string with checkmark', async () => {
      const { styled } = await import('../cli-symbols.js');
      const result = styled.success('Test message');

      // Should contain the success symbol and the message
      expect(result).toContain('Test message');
    });

    it('styled.error produces string with X', async () => {
      const { styled } = await import('../cli-symbols.js');
      const result = styled.error('Error message');

      expect(result).toContain('Error message');
    });

    it('styled.warning produces string with !', async () => {
      const { styled } = await import('../cli-symbols.js');
      const result = styled.warning('Warning message');

      expect(result).toContain('Warning message');
      expect(result).toContain('!');
    });

    it('styled.info produces string with info symbol', async () => {
      const { styled } = await import('../cli-symbols.js');
      const result = styled.info('Info message');

      expect(result).toContain('Info message');
    });

    it('styled.action produces string with arrow', async () => {
      const { styled } = await import('../cli-symbols.js');
      const result = styled.action('Action message');

      expect(result).toContain('Action message');
    });

    it('styled.label produces label-value pair', async () => {
      const { styled } = await import('../cli-symbols.js');
      const result = styled.label('Key:', 'Value');

      expect(result).toContain('Key:');
      expect(result).toContain('Value');
    });

    it('styled.phase produces visual progress bar', async () => {
      const { styled, symbols } = await import('../cli-symbols.js');
      const result = styled.phase(2, 5, 'Installing');

      // Should contain filled and empty progress segments
      expect(result).toContain(symbols.progressFilled);
      expect(result).toContain(symbols.progressEmpty);
      expect(result).toContain('Installing');
    });

    it('styled functions handle empty strings', async () => {
      const { styled } = await import('../cli-symbols.js');

      // Should not throw on empty strings
      expect(() => styled.success('')).not.toThrow();
      expect(() => styled.error('')).not.toThrow();
      expect(() => styled.warning('')).not.toThrow();
      expect(() => styled.info('')).not.toThrow();
      expect(() => styled.action('')).not.toThrow();
      expect(() => styled.label('', '')).not.toThrow();
      expect(() => styled.phase(0, 0, '')).not.toThrow();
    });
  });

  describe('asciiSymbols', () => {
    it('exports ASCII fallback symbols', async () => {
      const { asciiSymbols } = await import('../cli-symbols.js');

      expect(asciiSymbols.success).toBe('+');
      expect(asciiSymbols.error).toBe('x');
      expect(asciiSymbols.warning).toBe('!');
      expect(asciiSymbols.info).toBe('i');
      expect(asciiSymbols.arrow).toBe('->');
      expect(asciiSymbols.bullet).toBe('*');
    });
  });
});
