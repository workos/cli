import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InlinePromptProps {
  message: string;
  options: string[];
  onSelect: (value: string) => void;
}

export function InlinePrompt({ message, options, onSelect }: InlinePromptProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      onSelect(options[selectedIndex]);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold color="yellow">
        ? {message}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        {options.map((option, i) => (
          <Text key={i} color={i === selectedIndex ? 'cyan' : undefined}>
            {i === selectedIndex ? '› ' : '  '}
            {option}
          </Text>
        ))}
      </Box>
      <Text dimColor>↑/↓ to navigate, Enter to select</Text>
    </Box>
  );
}
