import { trace, SpanKind, SpanStatusCode, context } from '@opentelemetry/api';
import type { Span } from '@opentelemetry/api';
import type {
  TelemetryEventPayload,
  SessionStartEvent,
  SessionEndEvent,
  StepEvent,
  AgentToolEvent,
  AgentLLMEvent,
} from './types.js';

const tracer = trace.getTracer('wizard-telemetry');

// Track active sessions for parent-child relationships
const activeSessions = new Map<string, Span>();

export function processEvent(event: TelemetryEventPayload) {
  switch (event.type) {
    case 'session.start':
      return processSessionStart(event);
    case 'session.end':
      return processSessionEnd(event);
    case 'step':
      return processStep(event);
    case 'agent.tool':
    case 'agent.llm':
      return processAgentEvent(event);
  }
}

function processSessionStart(event: SessionStartEvent) {
  const span = tracer.startSpan('wizard.session', {
    kind: SpanKind.SERVER,
    attributes: event.attributes,
    startTime: new Date(event.timestamp),
  });
  activeSessions.set(event.sessionId, span);
  return span;
}

function processSessionEnd(event: SessionEndEvent) {
  const span = activeSessions.get(event.sessionId);
  if (!span) return;

  // Add all attributes
  for (const [key, value] of Object.entries(event.attributes)) {
    if (value !== undefined) span.setAttribute(key, value);
  }

  // Set status based on outcome
  if (event.attributes['wizard.outcome'] === 'error') {
    span.setStatus({ code: SpanStatusCode.ERROR });
  }

  span.end(new Date(event.timestamp));
  activeSessions.delete(event.sessionId);
}

function processStep(event: StepEvent) {
  const parentSpan = activeSessions.get(event.sessionId);
  const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined;

  const span = tracer.startSpan(
    `wizard.${event.name}`,
    {
      kind: SpanKind.INTERNAL,
      startTime: new Date(event.timestamp),
    },
    ctx,
  );

  span.setAttribute('duration_ms', event.durationMs);

  if (!event.success && event.error) {
    span.setStatus({ code: SpanStatusCode.ERROR, message: event.error.message });
    span.setAttribute('error.type', event.error.type);
  }

  // End immediately (step already completed)
  span.end(new Date(new Date(event.timestamp).getTime() + event.durationMs));
}

function processAgentEvent(event: AgentToolEvent | AgentLLMEvent) {
  const parentSpan = activeSessions.get(event.sessionId);
  const ctx = parentSpan ? trace.setSpan(context.active(), parentSpan) : undefined;

  const spanName = event.type === 'agent.tool' ? `wizard.agent.tool.${event.toolName}` : 'wizard.agent.llm';

  const span = tracer.startSpan(spanName, { kind: SpanKind.INTERNAL }, ctx);

  if (event.type === 'agent.tool') {
    span.setAttribute('duration_ms', event.durationMs);
    span.setAttribute('tool.name', event.toolName);
    span.setAttribute('success', event.success);
  } else {
    span.setAttribute('llm.model', event.model);
    span.setAttribute('llm.tokens.input', event.inputTokens);
    span.setAttribute('llm.tokens.output', event.outputTokens);
  }

  span.end();
}
