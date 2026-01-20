// Telemetry event types for wizard sessions

/** Base event shape - all events share these fields */
export interface TelemetryEvent {
  type: 'session.start' | 'session.end' | 'step' | 'agent.tool' | 'agent.llm';
  sessionId: string;
  timestamp: string; // ISO 8601
  attributes?: Record<string, string | number | boolean | undefined>;
}

export interface SessionStartEvent extends TelemetryEvent {
  type: 'session.start';
  attributes: {
    'wizard.version': string;
    'wizard.mode': 'cli' | 'tui';
    'workos.user_id'?: string;
    'workos.org_id'?: string;
  };
}

export interface SessionEndEvent extends TelemetryEvent {
  type: 'session.end';
  attributes: {
    'wizard.outcome': 'success' | 'error' | 'cancelled';
    'wizard.duration_ms': number;
    'wizard.framework'?: string;
    'wizard.error.type'?: string;
    'wizard.error.message'?: string;
    [key: string]: string | number | boolean | undefined;
  };
}

export interface StepEvent extends TelemetryEvent {
  type: 'step';
  name: string;
  durationMs: number;
  success: boolean;
  error?: { type: string; message: string };
}

export interface AgentToolEvent extends TelemetryEvent {
  type: 'agent.tool';
  toolName: string;
  durationMs: number;
  success: boolean;
}

export interface AgentLLMEvent extends TelemetryEvent {
  type: 'agent.llm';
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export type TelemetryEventPayload =
  | SessionStartEvent
  | SessionEndEvent
  | StepEvent
  | AgentToolEvent
  | AgentLLMEvent;

/** Batch request for telemetry endpoint */
export interface TelemetryRequest {
  events: TelemetryEventPayload[];
}
