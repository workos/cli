import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug.js';
import { telemetryClient } from './telemetry-client.js';
import type {
  SessionStartEvent,
  SessionEndEvent,
  StepEvent,
  AgentToolEvent,
  AgentLLMEvent,
} from './telemetry-types.js';
import { WORKOS_TELEMETRY_ENABLED } from '../lib/constants.js';

export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> = {};
  private sessionId: string;
  private sessionStartTime: Date;
  private distinctId?: string;

  // Agent metrics tracking
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private agentIterations = 0;

  constructor() {
    this.sessionId = uuidv4();
    this.sessionStartTime = new Date();
    this.tags = { $app_name: 'authkit-wizard' };
  }

  setDistinctId(distinctId: string) {
    this.distinctId = distinctId;
  }

  setAccessToken(token: string) {
    telemetryClient.setAccessToken(token);
  }

  setGatewayUrl(url: string) {
    telemetryClient.setGatewayUrl(url);
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    debug(`[Analytics] capture: ${eventName}`, properties);

    // Accumulate primitive values as tags for the session.end event
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (['string', 'number', 'boolean'].includes(typeof value)) {
          this.tags[key] = value as string | number | boolean;
        }
      }
    }
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    debug('[Analytics] captureException:', error.message, properties);
    this.tags['error.type'] = error.name;
    this.tags['error.message'] = error.message;
  }

  async getFeatureFlag(_flagKey: string): Promise<string | boolean | undefined> {
    // Feature flags not implemented yet
    return undefined;
  }

  sessionStart(mode: 'cli' | 'tui', version: string) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const event: SessionStartEvent = {
      type: 'session.start',
      sessionId: this.sessionId,
      timestamp: this.sessionStartTime.toISOString(),
      attributes: {
        'wizard.version': version,
        'wizard.mode': mode,
        'workos.user_id': this.distinctId,
      },
    };

    telemetryClient.queueEvent(event);
  }

  stepCompleted(name: string, durationMs: number, success: boolean, error?: Error) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const event: StepEvent = {
      type: 'step',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      name,
      durationMs,
      success,
      error: error ? { type: error.name, message: error.message } : undefined,
    };

    telemetryClient.queueEvent(event);
  }

  toolCalled(toolName: string, durationMs: number, success: boolean) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const event: AgentToolEvent = {
      type: 'agent.tool',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      toolName,
      durationMs,
      success,
    };

    telemetryClient.queueEvent(event);
  }

  llmRequest(model: string, inputTokens: number, outputTokens: number) {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;

    const event: AgentLLMEvent = {
      type: 'agent.llm',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      model,
      inputTokens,
      outputTokens,
    };

    telemetryClient.queueEvent(event);
  }

  incrementAgentIterations() {
    this.agentIterations++;
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (!WORKOS_TELEMETRY_ENABLED) return;

    const duration = Date.now() - this.sessionStartTime.getTime();

    // Filter out null/undefined tags
    const extraAttributes = Object.fromEntries(Object.entries(this.tags).filter(([, v]) => v != null)) as Record<
      string,
      string | number | boolean
    >;

    const event: SessionEndEvent = {
      type: 'session.end',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      attributes: {
        'wizard.outcome': status,
        'wizard.duration_ms': duration,
        'wizard.agent.iterations': this.agentIterations,
        'wizard.agent.tokens.input': this.totalInputTokens,
        'wizard.agent.tokens.output': this.totalOutputTokens,
        ...extraAttributes,
      },
    };

    telemetryClient.queueEvent(event);
    await telemetryClient.flush();
  }
}

export const analytics = new Analytics();
