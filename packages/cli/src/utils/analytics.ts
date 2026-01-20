import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug.js';
import { telemetryClient } from './telemetry-client.js';
import type { SessionStartEvent, SessionEndEvent } from './telemetry-types.js';
import { WIZARD_TELEMETRY_ENABLED } from '../lib/constants.js';

export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> = {};
  private sessionId: string;
  private sessionStartTime: Date;
  private distinctId?: string;

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
    if (!WIZARD_TELEMETRY_ENABLED) return;

    debug(`[Analytics] capture: ${eventName}`, properties);

    // Accumulate as tags for the session.end event
    // Phase 3 will add proper event tracking
    if (properties) {
      for (const [key, value] of Object.entries(properties)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          this.tags[key] = value;
        }
      }
    }
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    if (!WIZARD_TELEMETRY_ENABLED) return;

    debug('[Analytics] captureException:', error.message, properties);
    this.tags['error.type'] = error.name;
    this.tags['error.message'] = error.message;
  }

  async getFeatureFlag(_flagKey: string): Promise<string | boolean | undefined> {
    // Feature flags not implemented yet
    return undefined;
  }

  sessionStart(mode: 'cli' | 'tui', version: string) {
    if (!WIZARD_TELEMETRY_ENABLED) return;

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

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (!WIZARD_TELEMETRY_ENABLED) return;

    const duration = Date.now() - this.sessionStartTime.getTime();

    // Build extra attributes from accumulated tags
    const extraAttributes: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(this.tags)) {
      if (value !== null && value !== undefined) {
        extraAttributes[key] = value;
      }
    }

    const event: SessionEndEvent = {
      type: 'session.end',
      sessionId: this.sessionId,
      timestamp: new Date().toISOString(),
      attributes: {
        'wizard.outcome': status,
        'wizard.duration_ms': duration,
        ...extraAttributes,
      },
    };

    telemetryClient.queueEvent(event);
    await telemetryClient.flush();
  }
}

export const analytics = new Analytics();
