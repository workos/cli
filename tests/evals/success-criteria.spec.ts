import { describe, it, expect } from 'vitest';
import { validateResults, DEFAULT_CRITERIA, type SuccessCriteria } from './success-criteria.js';
import type { EvalResult } from './types.js';

function makeResult(passed: boolean, attempts: number = 1, correctionAttempts: number = 0): EvalResult {
  return {
    scenario: `test-${Math.random().toString(36).slice(2)}`,
    passed,
    duration: 1000,
    attempts,
    correctionAttempts,
  };
}

describe('success-criteria', () => {
  describe('DEFAULT_CRITERIA', () => {
    it('has expected default thresholds', () => {
      expect(DEFAULT_CRITERIA.firstAttemptPassRate).toBe(0.3);
      expect(DEFAULT_CRITERIA.withCorrectionPassRate).toBe(0.9);
      expect(DEFAULT_CRITERIA.withRetryPassRate).toBe(0.95);
    });
  });

  describe('validateResults', () => {
    it('returns passed=true when all criteria met', () => {
      // 10 results: 4 clean (40% > 30%), 5 corrected (9/10 = 90% correction), 1 retried (100% retry)
      const results: EvalResult[] = [
        ...Array(4)
          .fill(null)
          .map(() => makeResult(true, 1, 0)),
        ...Array(5)
          .fill(null)
          .map(() => makeResult(true, 1, 1)),
        makeResult(true, 2),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(true);
      expect(validation.failures).toHaveLength(0);
      expect(validation.actual.firstAttemptPassRate).toBe(0.4);
      expect(validation.actual.withCorrectionPassRate).toBe(0.9);
      expect(validation.actual.withRetryPassRate).toBe(1);
    });

    it('returns passed=false when first-attempt rate below threshold', () => {
      // 10 results, only 2 passed on first attempt (20% < 30% threshold)
      const results: EvalResult[] = [
        ...Array(2)
          .fill(null)
          .map(() => makeResult(true, 1)),
        ...Array(7)
          .fill(null)
          .map(() => makeResult(true, 2)),
        makeResult(true, 2),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(false);
      expect(validation.failures.some((f) => f.includes('First-attempt'))).toBe(true);
    });

    it('returns passed=false when with-retry rate below threshold', () => {
      // 10 results: 4 clean, 5 corrected (90% correction), 1 failed → 90% retry < 95%
      const results: EvalResult[] = [
        ...Array(4)
          .fill(null)
          .map(() => makeResult(true, 1, 0)),
        ...Array(5)
          .fill(null)
          .map(() => makeResult(true, 1, 1)),
        makeResult(false, 3),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(false);
      expect(validation.failures).toHaveLength(1);
      expect(validation.failures[0]).toContain('With-retry');
    });

    it('returns both failures when multiple criteria not met', () => {
      // 10 results, 2 passed first attempt (20% < 30%), 4 failed entirely (60% < 95% retry)
      const results: EvalResult[] = [
        ...Array(2)
          .fill(null)
          .map(() => makeResult(true, 1)),
        ...Array(4)
          .fill(null)
          .map(() => makeResult(true, 2)),
        ...Array(4)
          .fill(null)
          .map(() => makeResult(false, 3)),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(false);
      expect(validation.failures.length).toBeGreaterThanOrEqual(2);
    });

    it('handles empty results array', () => {
      const validation = validateResults([]);

      expect(validation.passed).toBe(false);
      expect(validation.actual.firstAttemptPassRate).toBe(0);
      expect(validation.actual.withRetryPassRate).toBe(0);
    });

    it('respects custom criteria', () => {
      const customCriteria: SuccessCriteria = {
        firstAttemptPassRate: 0.5,
        withRetryPassRate: 0.6,
      };

      // 5 out of 10 passed first attempt, 6 passed with retry
      const results: EvalResult[] = [
        ...Array(5)
          .fill(null)
          .map(() => makeResult(true, 1)),
        makeResult(true, 2),
        ...Array(4)
          .fill(null)
          .map(() => makeResult(false, 3)),
      ];

      const validation = validateResults(results, customCriteria);

      expect(validation.passed).toBe(true);
      expect(validation.criteria).toBe(customCriteria);
    });

    it('passes when exactly at threshold', () => {
      // 20 results:
      //   6 clean first-attempt (attempt=1, corrections=0) → 30% first-attempt
      //  12 self-corrected (attempt=1, corrections=1)       → 18/20 = 90% with-correction
      //   1 passed on scenario retry (attempt=2)             → 19/20 = 95% with-retry
      //   1 failed (attempt=3)
      const results: EvalResult[] = [
        ...Array(6)
          .fill(null)
          .map(() => makeResult(true, 1, 0)),
        ...Array(12)
          .fill(null)
          .map(() => makeResult(true, 1, 1)),
        makeResult(true, 2),
        makeResult(false, 3),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(true);
    });
  });
});
