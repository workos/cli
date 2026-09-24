import { useEffect, useState, useSyncExternalStore } from 'react';
import { useStdout } from 'ink';
import type { RunModel, RunSnapshot } from './model/run-model.js';
import { SPINNER_FRAMES } from './theme.js';

/** [columns, rows], updated on resize (Ink's useStdout doesn't re-render on resize). */
export function useTerminalSize(): [number, number] {
  const { stdout } = useStdout();
  const [size, setSize] = useState<[number, number]>(() => [stdout.columns || 80, stdout.rows || 24]);
  useEffect(() => {
    const onResize = () => setSize([stdout.columns || 80, stdout.rows || 24]);
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return size;
}

export function useRunSnapshot(model: RunModel): RunSnapshot {
  return useSyncExternalStore(model.subscribe, model.getSnapshot, model.getSnapshot);
}

/** Current spinner glyph while `active`. Purely visual: it never moves progress. */
export function useSpinner(active: boolean, intervalMs = 80): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER_FRAMES.length), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs]);
  return SPINNER_FRAMES[frame];
}
