import React from 'react';
import { Box, Text } from 'ink';
import type { RunProgressEvent } from '../events.js';

interface HeaderProps {
  progress: RunProgressEvent;
  concurrency: number;
}

export function Header({ progress, concurrency }: HeaderProps) {
  const elapsed = Math.round(progress.elapsed / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold>Evals </Text>
      <Text color="cyan">
        {progress.completed}/{progress.total}
      </Text>
      <Text> complete </Text>
      <Text dimColor>|</Text>
      <Text> </Text>
      <Text color="yellow">{progress.running}</Text>
      <Text> running </Text>
      <Text dimColor>|</Text>
      <Text> Concurrency: </Text>
      <Text color="green">{concurrency}</Text>
      <Text dimColor> | </Text>
      <Text>{timeStr}</Text>
    </Box>
  );
}
