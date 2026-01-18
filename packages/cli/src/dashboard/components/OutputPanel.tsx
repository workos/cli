import React, { useState, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import type { WizardEventEmitter } from '../../lib/events.js';

interface OutputPanelProps {
  emitter: WizardEventEmitter;
  maxLines?: number;
}

interface OutputLine {
  text: string;
  isError?: boolean;
  isStatus?: boolean;
}

export function OutputPanel({
  emitter,
  maxLines = 100,
}: OutputPanelProps): React.ReactElement {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const { stdout } = useStdout();
  const visibleLines = Math.floor((stdout?.rows || 24) * 0.35) - 4; // ~35% of terminal minus borders

  useEffect(() => {
    const handleOutput = ({ text, isError }: { text: string; isError?: boolean }) => {
      const newLines = text.split('\n').map((line) => ({
        text: line,
        isError,
        isStatus: line.includes('[STATUS]'),
      }));

      setLines((prev) => {
        const updated = [...prev, ...newLines];
        // Keep only last maxLines
        return updated.slice(-maxLines);
      });
    };

    const handleStatus = ({ message }: { message: string }) => {
      setLines((prev) => [
        ...prev,
        { text: `[STATUS] ${message}`, isStatus: true },
      ].slice(-maxLines));
    };

    emitter.on('output', handleOutput);
    emitter.on('status', handleStatus);

    return () => {
      emitter.off('output', handleOutput);
      emitter.off('status', handleStatus);
    };
  }, [emitter, maxLines]);

  // Get last N visible lines
  const displayLines = lines.slice(-visibleLines);

  return (
    <Box flexDirection="column" flexGrow={1}>
      {displayLines.length === 0 ? (
        <Text dimColor>Waiting for output...</Text>
      ) : (
        displayLines.map((line, i) => (
          <Text
            key={i}
            color={line.isError ? 'red' : line.isStatus ? 'yellow' : undefined}
          >
            {line.text}
          </Text>
        ))
      )}
    </Box>
  );
}
