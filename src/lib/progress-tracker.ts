/**
 * Progress tracking for wizard phases.
 * Maps xstate machine states to user-friendly phase names.
 */

export interface Phase {
  id: string;
  name: string;
  number: number;
}

export const PHASES: Phase[] = [
  { id: 'authenticating', name: 'Authentication', number: 1 },
  { id: 'preparing', name: 'Detection', number: 2 },
  { id: 'gatheringCredentials', name: 'Credentials', number: 3 },
  { id: 'configuring', name: 'Configuration', number: 4 },
  { id: 'runningAgent', name: 'Installation', number: 5 },
];

export class ProgressTracker {
  private currentPhase: Phase | null = null;
  private completedPhases: Phase[] = [];
  private readonly totalPhases = PHASES.length;

  enterPhase(stateId: string): void {
    const phase = PHASES.find((p) => p.id === stateId);
    if (phase) {
      this.currentPhase = phase;
    }
  }

  exitPhase(stateId: string): void {
    const phase = PHASES.find((p) => p.id === stateId);
    if (phase && !this.completedPhases.some((p) => p.id === phase.id)) {
      this.completedPhases.push(phase);
    }
  }

  getCurrentPhase(): Phase | null {
    return this.currentPhase;
  }

  getCurrentIndicator(): string {
    if (!this.currentPhase) return '';
    return `[${this.currentPhase.number}/${this.totalPhases}] ${this.currentPhase.name}`;
  }

  getCompletedSummary(): string[] {
    return this.completedPhases.map((p) => `✓ ${p.name}`);
  }

  isComplete(): boolean {
    return this.completedPhases.length === this.totalPhases;
  }

  reset(): void {
    this.currentPhase = null;
    this.completedPhases = [];
  }
}
