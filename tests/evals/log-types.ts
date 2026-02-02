import type { GradeCheck, ToolCall } from './types.js';

export interface LogMeta {
  timestamp: string;
  startTime: number;
  endTime?: number;
  totalDuration?: number;
  concurrency: number;
  cpuCount: number;
  cliFlags: {
    framework?: string;
    state?: string;
    verbose?: boolean;
    debug?: boolean;
    retry?: number;
  };
}

export interface LogScenarioAttempt {
  attempt: number;
  startTime: number;
  endTime: number;
  duration: number;
  passed: boolean;
  error?: string;
  checks?: GradeCheck[];
  toolCalls?: ToolCall[];
}

export interface LogScenario {
  scenario: string;
  framework: string;
  state: string;
  finalStatus: 'passed' | 'failed';
  totalDuration: number;
  attempts: LogScenarioAttempt[];
  agentOutput?: string;
  agentOutputTruncated?: boolean;
}

export interface LogSummary {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
}

export interface EvalLogFile {
  meta: LogMeta;
  scenarios: LogScenario[];
  summary: LogSummary;
}
