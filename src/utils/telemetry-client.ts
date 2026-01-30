import { debug } from './debug.js';
import type { TelemetryEvent, TelemetryRequest } from './telemetry-types.js';
import { getCredentials } from '../lib/credentials.js';

/**
 * HTTP client that queues telemetry events and flushes them to the gateway.
 * Failures are silent—telemetry should never crash the wizard.
 */
export class TelemetryClient {
  private events: TelemetryEvent[] = [];
  private accessToken: string | null = null;
  private gatewayUrl: string | null = null;

  setGatewayUrl(url: string) {
    this.gatewayUrl = url;
  }

  setAccessToken(token: string) {
    this.accessToken = token;
  }

  queueEvent(event: TelemetryEvent) {
    this.events.push(event);
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;
    if (!this.gatewayUrl) {
      debug('[Telemetry] No gateway URL configured, skipping flush');
      return;
    }

    const payload: TelemetryRequest = { events: [...this.events] };
    this.events = [];

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    // Read fresh credentials to handle token refresh mid-session
    const freshCreds = getCredentials();
    const token = freshCreds?.accessToken ?? this.accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      debug(`[Telemetry] Sending ${payload.events.length} events to ${this.gatewayUrl}/telemetry`);

      const response = await fetch(`${this.gatewayUrl}/telemetry`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        debug(`[Telemetry] Failed to send: ${response.status}`);
      }
    } catch (error) {
      debug(`[Telemetry] Error sending events: ${error}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const telemetryClient = new TelemetryClient();
