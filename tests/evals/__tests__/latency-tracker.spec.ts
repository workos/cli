import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { LatencyTracker } from '../latency-tracker.js';

describe('LatencyTracker', () => {
  let tracker: LatencyTracker;
  let mockTime: number;

  beforeEach(() => {
    tracker = new LatencyTracker();
    mockTime = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => mockTime);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('start()', () => {
    it('resets all counters', () => {
      // First run with some data
      tracker.start();
      mockTime = 100;
      tracker.recordFirstContent();
      tracker.startToolCall('Bash');
      mockTime = 200;
      tracker.endToolCall();
      tracker.recordTokens(1000, 500);

      // Start a new tracking session
      mockTime = 0;
      tracker.start();
      mockTime = 50;
      const metrics = tracker.finish();

      // Should be fresh - no TTFT recorded, no tools
      expect(metrics.ttftMs).toBeNull();
      expect(metrics.toolBreakdown).toHaveLength(0);
      expect(metrics.tokenMetrics?.inputTokens).toBe(0);
      expect(metrics.tokenMetrics?.outputTokens).toBe(0);
    });
  });

  describe('recordFirstContent()', () => {
    it('only records first call', () => {
      tracker.start();

      mockTime = 100;
      tracker.recordFirstContent();

      mockTime = 200;
      tracker.recordFirstContent(); // Should be ignored

      mockTime = 300;
      const metrics = tracker.finish();

      expect(metrics.ttftMs).toBe(100);
    });

    it('returns null if never called', () => {
      tracker.start();
      mockTime = 100;
      const metrics = tracker.finish();

      expect(metrics.ttftMs).toBeNull();
    });
  });

  describe('tool timing', () => {
    it('aggregates by tool name', () => {
      tracker.start();

      // First Bash call: 100ms
      mockTime = 0;
      tracker.startToolCall('Bash');
      mockTime = 100;
      tracker.endToolCall();

      // Second Bash call: 50ms
      mockTime = 150;
      tracker.startToolCall('Bash');
      mockTime = 200;
      tracker.endToolCall();

      // Write call: 30ms
      mockTime = 200;
      tracker.startToolCall('Write');
      mockTime = 230;
      tracker.endToolCall();

      mockTime = 300;
      const metrics = tracker.finish();

      const bashBreakdown = metrics.toolBreakdown?.find((t) => t.tool === 'Bash');
      const writeBreakdown = metrics.toolBreakdown?.find((t) => t.tool === 'Write');

      expect(bashBreakdown?.count).toBe(2);
      expect(bashBreakdown?.durationMs).toBe(150); // 100 + 50
      expect(writeBreakdown?.count).toBe(1);
      expect(writeBreakdown?.durationMs).toBe(30);
    });

    it('uses end time for unclosed tool calls', () => {
      tracker.start();

      mockTime = 0;
      tracker.startToolCall('Bash');
      // Don't call endToolCall

      mockTime = 100;
      const metrics = tracker.finish();

      expect(metrics.toolBreakdown?.[0]?.durationMs).toBe(100);
    });
  });

  describe('finish()', () => {
    it('calculates correct derived metrics', () => {
      tracker.start();

      // TTFT at 50ms
      mockTime = 50;
      tracker.recordFirstContent();

      // Tool takes 200ms (100-300)
      mockTime = 100;
      tracker.startToolCall('Bash');
      mockTime = 300;
      tracker.endToolCall();

      // Record tokens
      tracker.recordTokens(1000, 400);

      // End at 500ms
      mockTime = 500;
      const metrics = tracker.finish();

      expect(metrics.ttftMs).toBe(50);
      expect(metrics.totalDurationMs).toBe(500);
      expect(metrics.toolExecutionMs).toBe(200);
      expect(metrics.agentThinkingMs).toBe(300); // 500 - 200
      expect(metrics.tokenMetrics?.inputTokens).toBe(1000);
      expect(metrics.tokenMetrics?.outputTokens).toBe(400);
      // 400 tokens / 0.5 seconds = 800 tokens/sec
      expect(metrics.tokenMetrics?.tokensPerSecond).toBe(800);
    });

    it('returns 0 tool execution time for empty tool list', () => {
      tracker.start();
      mockTime = 100;
      const metrics = tracker.finish();

      expect(metrics.toolExecutionMs).toBe(0);
      expect(metrics.toolBreakdown).toHaveLength(0);
    });

    it('handles edge case of zero duration', () => {
      tracker.start();
      const metrics = tracker.finish();

      expect(metrics.totalDurationMs).toBe(0);
      expect(metrics.tokenMetrics?.tokensPerSecond).toBe(0);
    });

    it('clamps negative durations to 0', () => {
      tracker.start();
      mockTime = 100;
      tracker.startToolCall('Bash');
      // Simulate clock going backwards (edge case)
      mockTime = 50;
      tracker.endToolCall();

      const metrics = tracker.finish();

      // Duration should be clamped to 0, not negative
      expect(metrics.toolExecutionMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('recordTokens()', () => {
    it('records input and output tokens', () => {
      tracker.start();
      tracker.recordTokens(5000, 2000);

      mockTime = 1000; // 1 second
      const metrics = tracker.finish();

      expect(metrics.tokenMetrics?.inputTokens).toBe(5000);
      expect(metrics.tokenMetrics?.outputTokens).toBe(2000);
      expect(metrics.tokenMetrics?.tokensPerSecond).toBe(2000); // 2000 / 1
    });
  });
});
