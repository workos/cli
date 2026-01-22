import { useState, useEffect, useRef } from 'react';

interface UseAnimationOptions {
  frameCount: number;
  frameDelayMs: number;
  paused?: boolean;
}

export function useAnimation({ frameCount, frameDelayMs, paused = false }: UseAnimationOptions): number {
  const [frameIndex, setFrameIndex] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (paused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % frameCount);
    }, frameDelayMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [frameCount, frameDelayMs, paused]);

  return frameIndex;
}
