import React from 'react';
import { Box, Text } from 'ink';
import type { DashboardProps } from '../types.js';

// Minimal placeholder - full implementation in Phase 2
export function Dashboard({ emitter }: DashboardProps): React.ReactElement {
  return (
    <Box flexDirection="column" padding={1}>
      <Text color="cyan">Dashboard initialized</Text>
      <Text dimColor>Waiting for events...</Text>
    </Box>
  );
}
