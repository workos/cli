import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
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

  /**
   * Remove the last queued event of a given type.
   * Used to swap a provisional event with an updated one.
   */
  replaceLastEventOfType(type: TelemetryEvent['type']): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      if (this.events[i].type === type) {
        this.events.splice(i, 1);
        return;
      }
    }
  }

  /**
   * Queue multiple pre-formed events (used by store-forward recovery).
   */
  queueEvents(events: TelemetryEvent[]): void {
    this.events.push(...events);
  }

  async flush(): Promise<void> {
    if (this.events.length === 0) return;
    if (!this.gatewayUrl) {
      debug('[Telemetry] No gateway URL configured, skipping flush');
      return;
    }

    const payload: TelemetryRequest = { events: [...this.events] };
    // DO NOT clear this.events yet — retain until success

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

      if (response.ok) {
        this.events = [];
      } else {
        debug(`[Telemetry] Failed to send: ${response.status}`);
        // Events remain in queue for store-forward to persist
      }
    } catch (error) {
      debug(`[Telemetry] Error sending events: ${error}`);
      // Events remain in queue for store-forward to persist
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Synchronously write pending events to a file.
   * Used as last resort in process.on('exit') handler.
   */
  persistToFile(filePath: string): void {
    if (this.events.length === 0) return;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, JSON.stringify(this.events), 'utf-8');
      this.events = [];
    } catch {
      // Silent failure — telemetry must never block exit
    }
  }
}

export const telemetryClient = new TelemetryClient();
