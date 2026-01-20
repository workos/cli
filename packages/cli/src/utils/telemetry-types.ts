/**
 * Telemetry event types for wizard → gateway communication.
 * The gateway converts these to OTel format.
 */

export interface TelemetryEvent {
  type: 'session.start' | 'session.end' | 'step' | 'agent.tool' | 'agent.llm';
  sessionId: string;
  timestamp: string;
  attributes?: Record<string, string | number | boolean>;
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
  } & Record<string, string | number | boolean>;
}

export interface TelemetryRequest {
  events: TelemetryEvent[];
}
