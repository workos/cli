/**
 * Telemetry event types for installer → gateway communication.
 * The gateway converts these to OTel format.
 */

export interface TelemetryEvent {
  type: 'session.start' | 'session.end' | 'step' | 'agent.tool' | 'agent.llm' | 'command' | 'crash';
  sessionId: string;
  timestamp: string;
  attributes?: Record<string, string | number | boolean>;
}

export type AuthMode = 'jwt' | 'claim_token' | 'api_key' | 'none';

/**
 * Structured outcome dimension for command events. Supersedes the boolean
 * `command.success` as the primary categorization (`command.success` remains
 * for backward-compat). Populated by `analytics.recordTermination()` just
 * before `process.exit`.
 */
export type TerminationReason = 'success' | 'cancelled' | 'auth_required' | 'validation_error' | 'api_error' | 'crash';

export interface SessionStartEvent extends TelemetryEvent {
  type: 'session.start';
  attributes: {
    'installer.version': string;
    'installer.mode': 'cli' | 'tui' | 'headless';
    'workos.user_id'?: string;
    'workos.org_id'?: string;
    'device.id': string;
    'auth.mode': AuthMode;
    'env.os': string;
    'env.os_version': string;
    'env.node_version': string;
    'env.shell': string;
    'env.ci': boolean;
    'env.ci_provider'?: string;
  };
}

export interface SessionEndEvent extends TelemetryEvent {
  type: 'session.end';
  attributes: {
    'installer.outcome': 'success' | 'error' | 'cancelled';
    'installer.duration_ms': number;
  } & Record<string, string | number | boolean>;
}

export interface StepEvent extends TelemetryEvent {
  type: 'step';
  name: string;
  startTimestamp: string;
  durationMs: number;
  success: boolean;
  error?: {
    type: string;
    message: string;
  };
}

export interface AgentToolEvent extends TelemetryEvent {
  type: 'agent.tool';
  toolName: string;
  startTimestamp: string;
  durationMs: number;
  success: boolean;
}

export interface AgentLLMEvent extends TelemetryEvent {
  type: 'agent.llm';
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CommandEvent extends TelemetryEvent {
  type: 'command';
  attributes: {
    'command.name': string;
    'command.duration_ms': number;
    'command.success': boolean;
    'command.error_type'?: string;
    'command.error_message'?: string;
    'command.flags'?: string;
    'termination.reason'?: TerminationReason;
    'error.code'?: string;
    'api.status'?: number;
    'api.code'?: string;
    'api.resource'?: string;
    'cli.version': string;
    'workos.user_id'?: string;
    'device.id': string;
    'auth.mode': AuthMode;
    'env.os': string;
    'env.os_version': string;
    'env.node_version': string;
    'env.shell': string;
    'env.ci': boolean;
    'env.ci_provider'?: string;
  };
}

export interface CrashEvent extends TelemetryEvent {
  type: 'crash';
  attributes: {
    'crash.error_type': string;
    'crash.error_message': string;
    'crash.stack': string;
    'crash.command'?: string;
    'cli.version': string;
    'workos.user_id'?: string;
    'device.id': string;
    'auth.mode': AuthMode;
    'env.os': string;
    'env.os_version': string;
    'env.node_version': string;
    'env.shell': string;
    'env.ci': boolean;
    'env.ci_provider'?: string;
  };
}

export interface TelemetryRequest {
  events: TelemetryEvent[];
}
