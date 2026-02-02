import type { LatencyMetrics } from './types.js';

interface ToolTiming {
  tool: string;
  startMs: number;
  endMs?: number;
}

export class LatencyTracker {
  private startTime: number = 0;
  private firstContentTime: number | null = null;
  private toolTimings: ToolTiming[] = [];
  private currentTool: ToolTiming | null = null;
  private inputTokens: number = 0;
  private outputTokens: number = 0;

  start(): void {
    this.startTime = performance.now();
    this.firstContentTime = null;
    this.toolTimings = [];
    this.currentTool = null;
    this.inputTokens = 0;
    this.outputTokens = 0;
  }

  recordFirstContent(): void {
    if (this.firstContentTime === null) {
      this.firstContentTime = performance.now();
    }
  }

  startToolCall(toolName: string): void {
    this.currentTool = {
      tool: toolName,
      startMs: performance.now(),
    };
  }

  endToolCall(): void {
    if (this.currentTool) {
      this.currentTool.endMs = performance.now();
      this.toolTimings.push(this.currentTool);
      this.currentTool = null;
    }
  }

  recordTokens(input: number, output: number): void {
    this.inputTokens = input;
    this.outputTokens = output;
  }

  finish(): LatencyMetrics {
    const endTime = performance.now();
    const totalDurationMs = Math.max(0, endTime - this.startTime);

    // Calculate TTFT
    const ttftMs = this.firstContentTime ? Math.max(0, this.firstContentTime - this.startTime) : null;

    // Include any in-progress tool in the timings
    const allToolTimings = this.currentTool
      ? [...this.toolTimings, { ...this.currentTool, endMs: endTime }]
      : this.toolTimings;

    // Aggregate tool execution time
    const toolExecutionMs = allToolTimings.reduce((sum, t) => {
      const duration = (t.endMs ?? endTime) - t.startMs;
      return sum + Math.max(0, duration);
    }, 0);

    // Agent thinking = total - tool execution
    const agentThinkingMs = Math.max(0, totalDurationMs - toolExecutionMs);

    // Tool breakdown by type
    const toolCounts = new Map<string, { durationMs: number; count: number }>();
    for (const timing of allToolTimings) {
      const duration = Math.max(0, (timing.endMs ?? endTime) - timing.startMs);
      const existing = toolCounts.get(timing.tool) || { durationMs: 0, count: 0 };
      toolCounts.set(timing.tool, {
        durationMs: existing.durationMs + duration,
        count: existing.count + 1,
      });
    }

    const toolBreakdown = Array.from(toolCounts.entries()).map(([tool, data]) => ({
      tool,
      durationMs: Math.round(data.durationMs),
      count: data.count,
    }));

    // Calculate tokens per second
    const tokensPerSecond = totalDurationMs > 0 ? this.outputTokens / (totalDurationMs / 1000) : 0;

    return {
      ttftMs: ttftMs !== null ? Math.round(ttftMs) : null,
      agentThinkingMs: Math.round(agentThinkingMs),
      toolExecutionMs: Math.round(toolExecutionMs),
      totalDurationMs: Math.round(totalDurationMs),
      tokenMetrics: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        tokensPerSecond: Math.round(tokensPerSecond),
      },
      toolBreakdown,
    };
  }
}
