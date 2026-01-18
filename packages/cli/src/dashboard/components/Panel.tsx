import React from 'react';
import { Box, Text } from 'ink';

interface PanelProps {
  title?: string;
  children: React.ReactNode;
  borderColor?: string;
  flexGrow?: number;
  width?: string | number;
  height?: string | number;
}

export function Panel({
  title,
  children,
  borderColor = 'gray',
  flexGrow,
  width,
  height,
}: PanelProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      flexGrow={flexGrow}
      width={width}
      height={height}
    >
      {title && (
        <Box marginLeft={1}>
          <Text bold color="cyan">
            {title}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
}
