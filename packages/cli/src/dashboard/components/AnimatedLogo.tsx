import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useAnimation } from '../hooks/useAnimation.js';
import {
  getFrames,
  FRAME_DELAYS,
  type AnimationMode,
} from '../lib/logo-frames.js';

interface AnimatedLogoProps {
  mode?: AnimationMode;
  paused?: boolean;
}

export function AnimatedLogo({
  mode = 'spin',
  paused = false,
}: AnimatedLogoProps): React.ReactElement {
  const frames = useMemo(() => getFrames(mode), [mode]);
  const frameIndex = useAnimation({
    frameCount: frames.length,
    frameDelayMs: FRAME_DELAYS[mode],
    paused,
  });

  const frame = frames[frameIndex];

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      {frame.lines.map((line, i) => (
        <Text key={i}>
          {`\x1b[${frame.color}m${line}\x1b[0m`}
        </Text>
      ))}
      <Box marginTop={1}>
        <Text dimColor>WorkOS Installer</Text>
      </Box>
    </Box>
  );
}
