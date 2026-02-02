export interface GradeCheck {
  name: string;
  passed: boolean;
  message?: string;
  expected?: string;
  actual?: string;
}

export interface GradeResult {
  passed: boolean;
  checks: GradeCheck[];
}

export interface Grader {
  grade(): Promise<GradeResult>;
}

export interface EvalResult {
  scenario: string;
  passed: boolean;
  duration: number;
  checks?: GradeCheck[];
  agentOutput?: string;
  error?: string;
  attempts?: number;
  latencyMetrics?: LatencyMetrics;
  qualityGrade?: QualityGrade;
}

export interface EvalOptions {
  framework?: string;
  state?: string;
  verbose?: boolean;
  sequential?: boolean;
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  durationMs?: number;
}

/** Metadata captured at eval run start for version tracking */
export interface EvalResultMetadata {
  skillVersions: Record<string, string>;
  cliVersion: string;
  modelVersion: string;
  timestamp: string;
}

/** Latency metrics for performance tracking (Phase 3 stub) */
export interface LatencyMetrics {
  ttftMs: number | null;
  agentThinkingMs: number;
  toolExecutionMs: number;
  totalDurationMs: number;
  tokenMetrics?: {
    inputTokens: number;
    outputTokens: number;
    tokensPerSecond: number;
  };
  toolBreakdown?: Array<{
    tool: string;
    durationMs: number;
    count: number;
  }>;
}

/** Quality grading dimensions (Phase 4 stub) */
export interface QualityGrade {
  score: number;
  dimensions: {
    codeStyle: number;
    minimalism: number;
    errorHandling: number;
    idiomatic: number;
  };
  reasoning: string;
}
