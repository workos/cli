import type { EvalResult } from './types.js';

/**
 * Success criteria thresholds for eval runs.
 * Used to determine if an eval run meets quality bar for CI/CD.
 */
export interface SuccessCriteria {
  /**
   * Hard floor for first-attempt pass rate (0-1). Below this fails CI.
   * Kept deliberately low: first-attempt is sensitive to grader/SDK churn,
   * not just model quality, so the hard gate is reserved for actual collapse.
   */
  firstAttemptPassRate: number;
  /**
   * Target first-attempt pass rate (0-1). Rates in [floor, target) print as
   * warnings — visible drift signal but non-blocking. Optional.
   */
  firstAttemptTargetRate?: number;
  /** Minimum pass rate after within-session correction (0-1) */
  withCorrectionPassRate?: number;
  /** Minimum pass rate with full scenario retries (0-1) */
  withRetryPassRate: number;
  /** Maximum duration per scenario in ms (optional, for future use) */
  maxDurationMs?: number;
}

/**
 * Default thresholds for CI enforcement.
 *
 * Rationale: observed first-attempt rates across Opus 4.5/4.6/4.7 and Sonnet
 * 4.6 cluster around 35–58%. With-retry is the actual correctness gate (the
 * harness exists specifically to correct first-pass errors). First-attempt is
 * useful as a drift signal, not a hard gate.
 */
export const DEFAULT_CRITERIA: SuccessCriteria = {
  firstAttemptPassRate: 0.4,
  firstAttemptTargetRate: 0.5,
  withCorrectionPassRate: 0.9,
  withRetryPassRate: 0.95,
};

export interface ValidationResult {
  passed: boolean;
  criteria: SuccessCriteria;
  actual: {
    firstAttemptPassRate: number;
    withCorrectionPassRate: number;
    withRetryPassRate: number;
  };
  failures: string[];
  warnings: string[];
}

/**
 * Validate eval results against success criteria thresholds.
 * Returns detailed breakdown of pass/fail status with actionable messages.
 * Failures block CI; warnings are drift signals.
 */
export function validateResults(results: EvalResult[], criteria: SuccessCriteria = DEFAULT_CRITERIA): ValidationResult {
  // First attempt: passed on first scenario attempt with no corrections
  const firstAttemptPassed = results.filter(
    (r) => r.attempts === 1 && r.passed && (r.correctionAttempts ?? 0) === 0,
  ).length;
  // With correction: passed on first scenario attempt (may have used within-session correction)
  const withCorrectionPassed = results.filter((r) => r.attempts === 1 && r.passed).length;
  const totalPassed = results.filter((r) => r.passed).length;

  const firstAttemptRate = results.length > 0 ? firstAttemptPassed / results.length : 0;
  const withCorrectionRate = results.length > 0 ? withCorrectionPassed / results.length : 0;
  const withRetryRate = results.length > 0 ? totalPassed / results.length : 0;

  const failures: string[] = [];
  const warnings: string[] = [];

  if (firstAttemptRate < criteria.firstAttemptPassRate) {
    failures.push(
      `First-attempt pass rate ${(firstAttemptRate * 100).toFixed(1)}% < ${criteria.firstAttemptPassRate * 100}% floor (possible regression)`,
    );
  } else if (
    criteria.firstAttemptTargetRate !== undefined &&
    firstAttemptRate < criteria.firstAttemptTargetRate
  ) {
    warnings.push(
      `First-attempt pass rate ${(firstAttemptRate * 100).toFixed(1)}% below target ${criteria.firstAttemptTargetRate * 100}% — investigate drift`,
    );
  }
  if (criteria.withCorrectionPassRate !== undefined && withCorrectionRate < criteria.withCorrectionPassRate) {
    failures.push(
      `With-correction pass rate ${(withCorrectionRate * 100).toFixed(1)}% < ${criteria.withCorrectionPassRate * 100}% required`,
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
    actual: {
      firstAttemptPassRate: firstAttemptRate,
      withCorrectionPassRate: withCorrectionRate,
      withRetryPassRate: withRetryRate,
    },
    failures,
    warnings,
  };
}
