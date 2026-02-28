/**
 * NDJSON (Newline-Delimited JSON) writer for headless mode.
 *
 * Each line is a self-contained JSON object with a `type` discriminator
 * and an ISO-8601 `timestamp`. Consumers can parse line-by-line.
 */

export interface NDJSONEvent {
  type: string;
  timestamp: string;
  [key: string]: unknown;
}

/**
 * Write a single NDJSON event to stdout.
 * Automatically adds an ISO timestamp.
 */
export function writeNDJSON(event: Omit<NDJSONEvent, 'timestamp'>): void {
  const line = {
    ...event,
    timestamp: new Date().toISOString(),
  };
  process.stdout.write(JSON.stringify(line) + '\n');
}
