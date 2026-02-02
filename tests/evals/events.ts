import { EventEmitter } from 'node:events';
import type { GradeCheck, ToolCall } from './types.js';

export interface ScenarioEvent {
  scenario: string;
  framework: string;
  state: string;
}

export interface ScenarioStartEvent extends ScenarioEvent {
  attempt: number;
}

export interface ScenarioCompleteEvent extends ScenarioEvent {
  passed: boolean;
  duration: number;
  attempt: number;
  checks?: GradeCheck[];
  error?: string;
  toolCalls?: ToolCall[];
  agentOutput?: string;
}

export interface RunProgressEvent {
  completed: number;
  total: number;
  running: number;
  elapsed: number;
}

export type EvalEventType =
  | 'scenario:start'
  | 'scenario:retry'
  | 'scenario:pass'
  | 'scenario:fail'
  | 'scenario:complete'
  | 'run:progress'
  | 'run:complete';

export class EvalEventEmitter extends EventEmitter {
  emitScenarioStart(event: ScenarioStartEvent): void {
    this.emit('scenario:start', event);
  }

  emitScenarioRetry(event: ScenarioStartEvent): void {
    this.emit('scenario:retry', event);
  }

  emitScenarioPass(event: ScenarioCompleteEvent): void {
    this.emit('scenario:pass', event);
    this.emit('scenario:complete', event);
  }

  emitScenarioFail(event: ScenarioCompleteEvent): void {
    this.emit('scenario:fail', event);
    this.emit('scenario:complete', event);
  }

  emitProgress(event: RunProgressEvent): void {
    this.emit('run:progress', event);
  }

  emitRunComplete(): void {
    this.emit('run:complete');
  }
}

export const evalEvents = new EvalEventEmitter();
