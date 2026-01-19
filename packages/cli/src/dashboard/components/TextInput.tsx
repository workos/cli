import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useInput } from 'ink';

interface TextInputProps {
  label: string;
  placeholder?: string;
  mask?: boolean;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  focused?: boolean;
  error?: string;
}

export function TextInput({
  label,
  placeholder = '',
  mask = false,
  value,
  onChange,
  onSubmit,
  focused = true,
  error,
}: TextInputProps): React.ReactElement {
  const [cursorVisible, setCursorVisible] = useState(true);
  // Use ref for synchronous value tracking (fixes snippet tool race conditions)
  const valueRef = useRef(value);
  valueRef.current = value;

  // Blink cursor
  useEffect(() => {
    if (!focused) return;
    const interval = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 500);
    return () => clearInterval(interval);
  }, [focused]);

  useInput(
    (input, key) => {
      if (!focused) return;

      if (key.return) {
        onSubmit();
      } else if (key.ctrl && input === 'u') {
        // Ctrl+U: clear entire line
        valueRef.current = '';
        onChange('');
      } else if (key.backspace || key.delete) {
        // Use ref for current value to avoid stale closure
        const newValue = valueRef.current.slice(0, -1);
        valueRef.current = newValue;
        onChange(newValue);
      } else if (!key.ctrl && !key.meta && input && !key.upArrow && !key.downArrow) {
        // Handle snippet tool expansion: input may contain backspaces (\x7f or \x08)
        // followed by the replacement text
        let newValue = valueRef.current;

        for (const char of input) {
          if (char === '\x7f' || char === '\x08') {
            // Backspace - delete last character
            newValue = newValue.slice(0, -1);
          } else if (char.charCodeAt(0) >= 32) {
            // Only add printable characters
            newValue += char;
          }
        }

        valueRef.current = newValue;
        onChange(newValue);
      }
    },
    { isActive: focused },
  );

  const displayValue = mask ? '*'.repeat(value.length) : value;
  const showPlaceholder = value.length === 0;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan" bold>
          {label}:{' '}
        </Text>
        <Text dimColor={showPlaceholder}>
          {showPlaceholder ? placeholder : displayValue}
        </Text>
        {focused && cursorVisible && <Text color="cyan">|</Text>}
      </Box>
      {error && (
        <Text color="red" dimColor>
          {error}
        </Text>
      )}
    </Box>
  );
}
