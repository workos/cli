import type { TerminationReason } from './telemetry-types.js';

export interface CliExitContext {
  reason: TerminationReason;
  errorCode?: string;
  apiContext?: { status?: number; code?: string; resource?: string };
}

export class CliExit extends Error {
  constructor(
    readonly exitCode: number,
    readonly context?: CliExitContext,
  ) {
    super(`CLI exit: code ${exitCode}`);
    this.name = 'CliExit';
  }
}
