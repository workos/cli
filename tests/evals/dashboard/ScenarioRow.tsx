import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';

interface ScenarioRowProps {
  scenario: string;
  status: 'pending' | 'running' | 'retrying' | 'passed' | 'failed';
  attempt: number;
  duration?: number;
  error?: string;
  startTime?: number;
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: '-', color: 'gray' },
  running: { icon: '*', color: 'cyan' },
  retrying: { icon: '~', color: 'yellow' },
  passed: { icon: '+', color: 'green' },
  failed: { icon: 'x', color: 'red' },
};

export function ScenarioRow({ scenario, status, attempt, duration, error, startTime }: ScenarioRowProps) {
  const [liveElapsed, setLiveElapsed] = useState(0);

  useEffect(() => {
    if ((status === 'running' || status === 'retrying') && startTime) {
      const interval = setInterval(() => {
        setLiveElapsed(Math.round((Date.now() - startTime) / 1000));
      }, 500);
      return () => clearInterval(interval);
    }
  }, [status, startTime]);

  const { icon, color } = STATUS_ICONS[status];
  const durationStr = duration
    ? `${Math.round(duration / 1000)}s`
    : status === 'running' || status === 'retrying'
      ? `${liveElapsed}s`
      : '';

  return (
    <Box>
      <Box width={3}>
        <Text color={color as Parameters<typeof Text>[0]['color']}>{icon}</Text>
      </Box>
      <Box width={30}>
        <Text color={color as Parameters<typeof Text>[0]['color']}>{scenario}</Text>
      </Box>
      <Box width={8}>
        <Text dimColor>{durationStr}</Text>
      </Box>
      {attempt > 1 && <Text color="yellow"> (attempt {attempt})</Text>}
      {error && <Text color="red"> {error.slice(0, 50)}</Text>}
    </Box>
  );
}
