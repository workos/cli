import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeNDJSON } from './ndjson.js';

describe('writeNDJSON', () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.useRealTimers();
  });

  it('writes valid JSON followed by newline', () => {
    writeNDJSON({ type: 'test:event' });

    expect(writeSpy).toHaveBeenCalledTimes(1);
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output.endsWith('\n')).toBe(true);

    const parsed = JSON.parse(output.trim());
    expect(parsed.type).toBe('test:event');
  });

  it('includes ISO timestamp', () => {
    writeNDJSON({ type: 'test:event' });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.timestamp).toBe('2026-01-15T12:00:00.000Z');
  });

  it('passes through additional payload fields', () => {
    writeNDJSON({ type: 'detection:complete', integration: 'nextjs' });

    const output = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output.trim());
    expect(parsed.integration).toBe('nextjs');
  });

  it('outputs exactly one line per call', () => {
    writeNDJSON({ type: 'event1' });
    writeNDJSON({ type: 'event2' });

    expect(writeSpy).toHaveBeenCalledTimes(2);
    for (const call of writeSpy.mock.calls) {
      const output = call[0] as string;
      const lines = output.split('\n').filter(Boolean);
      expect(lines).toHaveLength(1);
    }
  });

  it('produces parseable NDJSON stream', () => {
    writeNDJSON({ type: 'start' });
    writeNDJSON({ type: 'progress', step: 'installing' });
    writeNDJSON({ type: 'complete', success: true });

    const allOutput = writeSpy.mock.calls.map((c) => c[0] as string).join('');
    const lines = allOutput.trim().split('\n');
    expect(lines).toHaveLength(3);

    for (const line of lines) {
      const parsed = JSON.parse(line);
      expect(parsed).toHaveProperty('type');
      expect(parsed).toHaveProperty('timestamp');
    }
  });
});
