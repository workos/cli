import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressTracker, PHASES } from '../progress-tracker.js';

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;

  beforeEach(() => {
    tracker = new ProgressTracker();
  });

  describe('enterPhase', () => {
    it('updates currentPhase for known state', () => {
      tracker.enterPhase('authenticating');
      expect(tracker.getCurrentPhase()?.id).toBe('authenticating');
      expect(tracker.getCurrentPhase()?.name).toBe('Authentication');
    });

    it('ignores unknown state ids', () => {
      tracker.enterPhase('unknown_state');
      expect(tracker.getCurrentPhase()).toBeNull();
    });

    it('updates to new phase when entering different state', () => {
      tracker.enterPhase('authenticating');
      tracker.enterPhase('preparing');
      expect(tracker.getCurrentPhase()?.id).toBe('preparing');
    });
  });

  describe('exitPhase', () => {
    it('adds phase to completedPhases', () => {
      tracker.enterPhase('authenticating');
      tracker.exitPhase('authenticating');
      expect(tracker.getCompletedSummary()).toContain('✓ Authentication');
    });

    it('does not duplicate completed phases', () => {
      tracker.exitPhase('authenticating');
      tracker.exitPhase('authenticating');
      expect(tracker.getCompletedSummary().filter((s) => s.includes('Authentication'))).toHaveLength(1);
    });

    it('ignores unknown state ids', () => {
      tracker.exitPhase('unknown_state');
      expect(tracker.getCompletedSummary()).toHaveLength(0);
    });
  });

  describe('getCurrentIndicator', () => {
    it('returns empty string when no phase is active', () => {
      expect(tracker.getCurrentIndicator()).toBe('');
    });

    it('formats indicator correctly', () => {
      tracker.enterPhase('authenticating');
      expect(tracker.getCurrentIndicator()).toBe('[1/5] Authentication');
    });

    it('shows correct phase number', () => {
      tracker.enterPhase('runningAgent');
      expect(tracker.getCurrentIndicator()).toBe('[5/5] Installation');
    });
  });

  describe('getCompletedSummary', () => {
    it('returns empty array initially', () => {
      expect(tracker.getCompletedSummary()).toEqual([]);
    });

    it('includes all completed phases', () => {
      tracker.exitPhase('authenticating');
      tracker.exitPhase('preparing');
      const summary = tracker.getCompletedSummary();
      expect(summary).toContain('✓ Authentication');
      expect(summary).toContain('✓ Detection');
    });
  });

  describe('isComplete', () => {
    it('returns false when not all phases completed', () => {
      tracker.exitPhase('authenticating');
      expect(tracker.isComplete()).toBe(false);
    });

    it('returns true when all phases completed', () => {
      PHASES.forEach((phase) => tracker.exitPhase(phase.id));
      expect(tracker.isComplete()).toBe(true);
    });
  });

  describe('reset', () => {
    it('clears current phase and completed phases', () => {
      tracker.enterPhase('authenticating');
      tracker.exitPhase('authenticating');
      tracker.reset();
      expect(tracker.getCurrentPhase()).toBeNull();
      expect(tracker.getCompletedSummary()).toEqual([]);
    });
  });

  describe('full workflow', () => {
    it('tracks multiple enter/exit cycles correctly', () => {
      // Simulate wizard flow
      tracker.enterPhase('authenticating');
      expect(tracker.getCurrentIndicator()).toBe('[1/5] Authentication');

      tracker.exitPhase('authenticating');
      tracker.enterPhase('preparing');
      expect(tracker.getCurrentIndicator()).toBe('[2/5] Detection');

      tracker.exitPhase('preparing');
      tracker.enterPhase('gatheringCredentials');
      expect(tracker.getCurrentIndicator()).toBe('[3/5] Credentials');

      // Verify completed phases tracked
      const summary = tracker.getCompletedSummary();
      expect(summary).toHaveLength(2);
      expect(summary).toContain('✓ Authentication');
      expect(summary).toContain('✓ Detection');
    });
  });
});
