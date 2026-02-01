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
}

export interface EvalOptions {
  framework?: string;
  state?: string;
  verbose?: boolean;
}

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  durationMs?: number;
}
