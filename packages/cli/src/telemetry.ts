import { analytics } from './utils/analytics.js';

/**
 * Trace a wizard step with timing and success/failure tracking.
 * Handles both sync and async callbacks.
 */
export function traceStep<T>(step: string, callback: () => T): T {
  const startTime = Date.now();
  updateProgress(step);

  try {
    const result = callback();

    // Handle async callbacks
    if (result instanceof Promise) {
      return result
        .then((value) => {
          analytics.stepCompleted(step, Date.now() - startTime, true);
          return value;
        })
        .catch((error) => {
          analytics.stepCompleted(step, Date.now() - startTime, false, error);
          throw error;
        }) as T;
    }

    // Sync callback
    analytics.stepCompleted(step, Date.now() - startTime, true);
    return result;
  } catch (error) {
    analytics.stepCompleted(step, Date.now() - startTime, false, error as Error);
    throw error;
  }
}

export function updateProgress(step: string) {
  analytics.setTag('progress', step);
}
