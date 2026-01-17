import { analytics } from './utils/analytics.js';

export function traceStep<T>(step: string, callback: () => T): T {
  updateProgress(step);
  return callback();
}

export function updateProgress(step: string) {
  analytics.setTag('progress', step);
}
