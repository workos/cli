import { createWizardEventEmitter, type WizardEventName, type WizardEvents } from '../events.js';

/**
 * Captured event with type and payload.
 */
export interface CapturedEvent<K extends WizardEventName = WizardEventName> {
  type: K;
  payload: WizardEvents[K];
  timestamp: number;
}

/**
 * Creates an event capture utility for testing.
 * Records all events emitted through the emitter.
 */
export function createEventCapture() {
  const emitter = createWizardEventEmitter();
  const events: CapturedEvent[] = [];

  // All event types to capture
  const eventTypes: WizardEventName[] = [
    'status',
    'output',
    'complete',
    'error',
    'state:enter',
    'state:exit',
    'auth:checking',
    'auth:required',
    'auth:success',
    'auth:failure',
    'detection:start',
    'detection:complete',
    'detection:none',
    'git:checking',
    'git:clean',
    'git:dirty',
    'git:dirty:confirmed',
    'git:dirty:cancelled',
    'credentials:gathering',
    'credentials:request',
    'credentials:response',
    'config:start',
    'config:complete',
    'agent:start',
    'agent:progress',
    'agent:success',
    'agent:failure',
    'file:write',
    'file:edit',
    'prompt:request',
    'prompt:response',
    'confirm:request',
    'confirm:response',
  ];

  // Subscribe to all event types
  for (const type of eventTypes) {
    emitter.on(type, (payload: WizardEvents[typeof type]) => {
      events.push({
        type,
        payload,
        timestamp: Date.now(),
      });
    });
  }

  return {
    /** The emitter to pass to machine/adapters */
    emitter,

    /** Get all captured events */
    getEvents: () => [...events],

    /** Get just the event types in order */
    getEventTypes: () => events.map((e) => e.type),

    /** Get events of a specific type */
    getEventsOfType: <K extends WizardEventName>(type: K): CapturedEvent<K>[] =>
      events.filter((e): e is CapturedEvent<K> => e.type === type),

    /** Clear captured events */
    clear: () => {
      events.length = 0;
    },

    /** Get count of events */
    count: () => events.length,
  };
}

/**
 * Compare two event type sequences for equality.
 * Returns match result with diff info if different.
 */
export function compareEventSequences(
  seq1: WizardEventName[],
  seq2: WizardEventName[],
): { match: boolean; diff?: string } {
  // Check lengths
  if (seq1.length !== seq2.length) {
    return {
      match: false,
      diff:
        `Length mismatch: ${seq1.length} vs ${seq2.length}\n` +
        `Seq1: ${seq1.join(' → ')}\n` +
        `Seq2: ${seq2.join(' → ')}`,
    };
  }

  // Check each position
  for (let i = 0; i < seq1.length; i++) {
    if (seq1[i] !== seq2[i]) {
      return {
        match: false,
        diff:
          `Event ${i} differs: "${seq1[i]}" vs "${seq2[i]}"\n` +
          `Context: ...${seq1.slice(Math.max(0, i - 2), i + 3).join(' → ')}...`,
      };
    }
  }

  return { match: true };
}

/**
 * Filter out non-deterministic events for comparison.
 * Some events (like timestamps) shouldn't affect sequence equality.
 */
export function filterDeterministicEvents(events: WizardEventName[]): WizardEventName[] {
  // Currently all events are deterministic, but this could filter
  // things like progress events with variable timing
  return events;
}
