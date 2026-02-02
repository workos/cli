import os from 'node:os';

export interface ConcurrencyInfo {
  detected: number;
  effective: number;
  reason: string;
}

export function detectConcurrency(): ConcurrencyInfo {
  const cpuCount = os.cpus().length;

  // Leave 1 core for system, cap at 8 to avoid Claude SDK rate limits
  const effective = Math.max(2, Math.min(cpuCount - 1, 8));

  return {
    detected: cpuCount,
    effective,
    reason:
      cpuCount <= 2
        ? 'Low core count, using minimum concurrency'
        : cpuCount > 8
          ? 'Capped at 8 to avoid rate limits'
          : 'Using CPU cores minus 1',
  };
}
