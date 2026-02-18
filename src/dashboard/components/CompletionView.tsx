import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { getLockArt, type LockExpression } from '../../utils/lock-art.js';

interface OutputLine {
  text: string;
  isError?: boolean;
  isStatus?: boolean;
}

interface CompletionViewProps {
  success: boolean;
  summary?: string;
  outputLog: OutputLine[];
}

export function CompletionView({ success, summary, outputLog }: CompletionViewProps): React.ReactElement {
  const { exit } = useApp();
  const [scrollOffset, setScrollOffset] = useState(Math.max(0, outputLog.length - 20));

  useInput((input, key) => {
    if (key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setScrollOffset((prev) => Math.min(outputLog.length - 1, prev + 1));
    } else if (key.return || input === 'q') {
      exit();
    }
  });

  const visibleLines = outputLog.slice(scrollOffset, scrollOffset + 20);

  const expression: LockExpression = success ? 'success' : 'error';
  const lockLines = getLockArt(expression, false);
  const color = success ? 'green' : 'red';

  return (
    <Box flexDirection="column" padding={1} width="100%" height="100%">
      {/* Lock + Header */}
      <Box marginBottom={1}>
        <Box flexDirection="column" marginRight={2}>
          {lockLines.map((line, i) => (
            <Text key={i} color={color}>{line}</Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center">
          <Text bold color={color}>
            {success ? 'WorkOS AuthKit Installed' : 'Installation Failed'}
          </Text>
          {summary && <Text dimColor>{summary}</Text>}
        </Box>
      </Box>

      {/* Scrollable Log */}
      <Box flexDirection="column" borderStyle="round" borderColor="gray" flexGrow={1} paddingX={1}>
        <Text bold dimColor>
          Output Log [{scrollOffset + 1}-{scrollOffset + visibleLines.length} of {outputLog.length}]
        </Text>
        {visibleLines.map((line, i) => (
          <Text key={i} color={line.isError ? 'red' : line.isStatus ? 'yellow' : undefined}>
            {line.text}
          </Text>
        ))}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ to scroll, Enter or Q to exit</Text>
      </Box>
    </Box>
  );
}
