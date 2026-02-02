import { describe, it, expect } from 'vitest';
import { validateResults, DEFAULT_CRITERIA, type SuccessCriteria } from './success-criteria.js';
import type { EvalResult } from './types.js';

function makeResult(passed: boolean, attempts: number = 1): EvalResult {
  return {
    scenario: `test-${Math.random().toString(36).slice(2)}`,
    passed,
    duration: 1000,
    attempts,
  };
}

describe('success-criteria', () => {
  describe('DEFAULT_CRITERIA', () => {
    it('has expected default thresholds', () => {
      expect(DEFAULT_CRITERIA.firstAttemptPassRate).toBe(0.9);
      expect(DEFAULT_CRITERIA.withRetryPassRate).toBe(0.95);
    });
  });

  describe('validateResults', () => {
    it('returns passed=true when all criteria met', () => {
      // 10 results, 9 passed on first attempt, 1 passed on retry
      const results: EvalResult[] = [
        ...Array(9)
          .fill(null)
          .map(() => makeResult(true, 1)),
        makeResult(true, 2),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(true);
      expect(validation.failures).toHaveLength(0);
      expect(validation.actual.firstAttemptPassRate).toBe(0.9);
      expect(validation.actual.withRetryPassRate).toBe(1);
    });

    it('returns passed=false when first-attempt rate below threshold', () => {
      // 10 results, only 8 passed on first attempt
      const results: EvalResult[] = [
        ...Array(8)
          .fill(null)
          .map(() => makeResult(true, 1)),
        makeResult(true, 2),
        makeResult(true, 2),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(false);
      expect(validation.failures).toHaveLength(1);
      expect(validation.failures[0]).toContain('First-attempt');
      expect(validation.failures[0]).toContain('80.0%');
    });

    it('returns passed=false when with-retry rate below threshold', () => {
      // 10 results, 9 passed first attempt, 1 failed entirely
      const results: EvalResult[] = [
        ...Array(9)
          .fill(null)
          .map(() => makeResult(true, 1)),
        makeResult(false, 3),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(false);
      expect(validation.failures).toHaveLength(1);
      expect(validation.failures[0]).toContain('With-retry');
    });

    it('returns both failures when both criteria not met', () => {
      // 10 results, 7 passed first attempt, 1 failed
      const results: EvalResult[] = [
        ...Array(7)
          .fill(null)
          .map(() => makeResult(true, 1)),
        makeResult(true, 2),
        makeResult(true, 2),
        makeResult(false, 3),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(false);
      expect(validation.failures).toHaveLength(2);
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
      // Exactly 90% first-attempt, 95% with-retry
      const results: EvalResult[] = [
        ...Array(18)
          .fill(null)
          .map(() => makeResult(true, 1)),
        makeResult(true, 2),
        makeResult(false, 3),
      ];

      const validation = validateResults(results);

      expect(validation.passed).toBe(true);
    });
  });
});
