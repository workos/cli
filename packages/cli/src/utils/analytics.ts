import { ANALYTICS_ENABLED } from '../lib/constants.js';
import { v4 as uuidv4 } from 'uuid';
import { debug } from './debug.js';

// Stub analytics class - telemetry disabled for WorkOS wizard
// Can be re-enabled later if WorkOS wants usage tracking
export class Analytics {
  private tags: Record<string, string | boolean | number | null | undefined> = {};
  private distinctId?: string;
  private anonymousId: string;
  private appName = 'authkit-wizard';

  constructor() {
    this.tags = { $app_name: this.appName };
    this.anonymousId = uuidv4();
    this.distinctId = undefined;
  }

  setDistinctId(distinctId: string) {
    this.distinctId = distinctId;
    // No-op when analytics disabled
  }

  setTag(key: string, value: string | boolean | number | null | undefined) {
    this.tags[key] = value;
  }

  captureException(error: Error, properties: Record<string, unknown> = {}) {
    if (ANALYTICS_ENABLED) {
      debug('Analytics exception:', error.message, properties);
    }
    // No-op when analytics disabled
  }

  capture(eventName: string, properties?: Record<string, unknown>) {
    if (ANALYTICS_ENABLED) {
      debug('Analytics capture:', eventName, properties);
    }
    // No-op when analytics disabled
  }

  async getFeatureFlag(flagKey: string): Promise<string | boolean | undefined> {
    // Feature flags disabled - always return undefined
    return undefined;
  }

  async shutdown(status: 'success' | 'error' | 'cancelled') {
    if (ANALYTICS_ENABLED) {
      debug('Analytics shutdown:', status);
    }
    // No-op when analytics disabled
  }
}

export const analytics = new Analytics();
