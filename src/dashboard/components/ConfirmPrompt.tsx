import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface ConfirmPromptProps {
  message: string;
  warning?: string;
  files?: string[];
  onConfirm: (confirmed: boolean) => void;
}

export function ConfirmPrompt({ message, warning, files, onConfirm }: ConfirmPromptProps): React.ReactElement {
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  useInput((input, key) => {
    if (key.leftArrow || input === 'h') {
      setSelected('yes');
    } else if (key.rightArrow || input === 'l') {
      setSelected('no');
    } else if (input === 'y' || input === 'Y') {
      onConfirm(true);
    } else if (input === 'n' || input === 'N') {
      onConfirm(false);
    } else if (key.return) {
      onConfirm(selected === 'yes');
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      {warning && (
        <Box marginBottom={1}>
          <Text color="yellow" bold>
            ⚠ {warning}
          </Text>
        </Box>
      )}

      {files && files.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {files.slice(0, 10).map((file, i) => (
            <Text key={i} dimColor>
              {file}
            </Text>
          ))}
          {files.length > 10 && <Text dimColor>...and {files.length - 10} more</Text>}
        </Box>
      )}

      <Box marginBottom={1}>
        <Text>{message}</Text>
      </Box>

      <Box>
        <Text color={selected === 'yes' ? 'cyan' : undefined} bold={selected === 'yes'}>
          {selected === 'yes' ? '● ' : '○ '}Yes
        </Text>
        <Text> </Text>
        <Text color={selected === 'no' ? 'cyan' : undefined} bold={selected === 'no'}>
          {selected === 'no' ? '● ' : '○ '}No
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>←/→ or y/n to select | Enter to confirm</Text>
      </Box>
    </Box>
  );
}
