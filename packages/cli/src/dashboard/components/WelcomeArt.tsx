import React from 'react';
import { Box, Text } from 'ink';
import { getWelcomeArt } from '../lib/welcome-art.js';

export function WelcomeArt(): React.ReactElement {
  const art = getWelcomeArt();
  const lines = art.split('\n');

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" flexGrow={1}>
      <Box flexDirection="column">
        {lines.map((line, i) => (
          <Text key={i} color="cyan">
            {line}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
