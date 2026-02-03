import type { EvalResult } from './types.js';

/**
 * Success criteria thresholds for eval runs.
 * Used to determine if an eval run meets quality bar for CI/CD.
 */
export interface SuccessCriteria {
  /** Minimum pass rate on first attempt (0-1) */
  firstAttemptPassRate: number;
  /** Minimum pass rate with retries (0-1) */
  withRetryPassRate: number;
  /** Maximum duration per scenario in ms (optional, for future use) */
  maxDurationMs?: number;
}

/** Default thresholds for CI enforcement */
export const DEFAULT_CRITERIA: SuccessCriteria = {
  firstAttemptPassRate: 0.9,
  withRetryPassRate: 0.95,
};

export interface ValidationResult {
  passed: boolean;
  criteria: SuccessCriteria;
  actual: {
    firstAttemptPassRate: number;
    withRetryPassRate: number;
  };
  failures: string[];
}

/**
 * Validate eval results against success criteria thresholds.
 * Returns detailed breakdown of pass/fail status with actionable messages.
 */
export function validateResults(results: EvalResult[], criteria: SuccessCriteria = DEFAULT_CRITERIA): ValidationResult {
  const firstAttemptPassed = results.filter((r) => r.attempts === 1 && r.passed).length;
  const totalPassed = results.filter((r) => r.passed).length;

  const firstAttemptRate = results.length > 0 ? firstAttemptPassed / results.length : 0;
  const withRetryRate = results.length > 0 ? totalPassed / results.length : 0;

  const failures: string[] = [];
  if (firstAttemptRate < criteria.firstAttemptPassRate) {
    failures.push(
      `First-attempt pass rate ${(firstAttemptRate * 100).toFixed(1)}% < ${criteria.firstAttemptPassRate * 100}% required`,
    );
  }
  if (withRetryRate < criteria.withRetryPassRate) {
    failures.push(
      `With-retry pass rate ${(withRetryRate * 100).toFixed(1)}% < ${criteria.withRetryPassRate * 100}% required`,
    );
  }

  return {
    passed: failures.length === 0,
    criteria,
    actual: { firstAttemptPassRate: firstAttemptRate, withRetryPassRate: withRetryRate },
    failures,
  };
}
