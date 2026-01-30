import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import type { InstallerEventEmitter } from '../../lib/events.js';
import { InlinePrompt } from './InlinePrompt.js';

interface OutputPanelProps {
  emitter: InstallerEventEmitter;
  maxLines?: number;
  focused?: boolean;
  height?: number;
}

interface OutputLine {
  text: string;
  isError?: boolean;
  isStatus?: boolean;
}

interface ActivePrompt {
  id: string;
  message: string;
  options: string[];
}

export function OutputPanel({
  emitter,
  maxLines = 100,
  focused = false,
  height,
}: OutputPanelProps): React.ReactElement {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [scrollOffset, setScrollOffset] = useState<number | null>(null); // null = auto-scroll to bottom
  const [activePrompt, setActivePrompt] = useState<ActivePrompt | null>(null);
  const lastKeyRef = useRef<string>('');
  const { stdout } = useStdout();
  // Use provided height or fall back to calculated height
  const visibleLines = height ?? Math.floor((stdout?.rows || 24) * 0.35) - 4;

  useEffect(() => {
    const handleOutput = ({ text, isError }: { text: string; isError?: boolean }) => {
      const newLines = text.split('\n').map((line) => ({
        text: line,
        isError,
        isStatus: line.includes('[STATUS]'),
      }));

      setLines((prev) => [...prev, ...newLines].slice(-maxLines));
      // Auto-scroll to bottom when new content arrives (if not manually scrolled)
      setScrollOffset(null);
    };

    const handleStatus = ({ message }: { message: string }) => {
      setLines((prev) => [...prev, { text: `[STATUS] ${message}`, isStatus: true }].slice(-maxLines));
      setScrollOffset(null);
    };

    const handlePromptRequest = ({ id, message, options }: { id: string; message: string; options?: string[] }) => {
      if (options && options.length > 0) {
        setActivePrompt({ id, message, options });
      }
    };

    emitter.on('output', handleOutput);
    emitter.on('status', handleStatus);
    emitter.on('prompt:request', handlePromptRequest);

    return () => {
      emitter.off('output', handleOutput);
      emitter.off('status', handleStatus);
      emitter.off('prompt:request', handlePromptRequest);
    };
  }, [emitter, maxLines]);

  // Vim-style keyboard navigation (only when focused)
  useInput((input, key) => {
    if (!focused) return;

    const maxOffset = Math.max(0, lines.length - visibleLines);
    const halfPage = Math.floor(visibleLines / 2);
    const currentOffset = scrollOffset ?? maxOffset;

    // j/k or arrow keys for line-by-line
    if (input === 'j' || key.downArrow) {
      setScrollOffset(Math.min(maxOffset, currentOffset + 1));
    } else if (input === 'k' || key.upArrow) {
      setScrollOffset(Math.max(0, currentOffset - 1));
    }
    // Ctrl-d / Ctrl-u for half-page
    else if (key.ctrl && input === 'd') {
      setScrollOffset(Math.min(maxOffset, currentOffset + halfPage));
    } else if (key.ctrl && input === 'u') {
      setScrollOffset(Math.max(0, currentOffset - halfPage));
    }
    // G for bottom (and resume auto-scroll), gg for top
    else if (input === 'G') {
      setScrollOffset(null); // Resume auto-scroll
    } else if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        setScrollOffset(0);
        lastKeyRef.current = '';
      } else {
        lastKeyRef.current = 'g';
        setTimeout(() => {
          lastKeyRef.current = '';
        }, 500);
      }
    }
  });

  const handlePromptSelect = (value: string) => {
    if (activePrompt) {
      emitter.emit('prompt:response', { id: activePrompt.id, value });
      setLines((prev) =>
        [...prev, { text: `? ${activePrompt.message}`, isStatus: true }, { text: `  → ${value}` }].slice(-maxLines),
      );
      setActivePrompt(null);
    }
  };

  // Calculate display range
  const promptHeight = activePrompt ? 5 + activePrompt.options.length : 0;
  // Reserve 1 line for scroll indicator if needed
  const hasScroll = lines.length > visibleLines - promptHeight - 1;
  const contentLines = hasScroll ? visibleLines - promptHeight - 1 : visibleLines - promptHeight;
  const maxOffset = Math.max(0, lines.length - contentLines);
  const effectiveOffset = scrollOffset ?? maxOffset;
  const displayLines = lines.slice(Math.max(0, effectiveOffset), Math.max(0, effectiveOffset) + contentLines);

  // Calculate scrollbar position
  const scrollbarHeight = lines.length > 0 ? Math.max(1, Math.floor((contentLines / lines.length) * contentLines)) : 1;
  const scrollbarPosition =
    maxOffset > 0 ? Math.floor((effectiveOffset / maxOffset) * (contentLines - scrollbarHeight)) : 0;

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {displayLines.length === 0 && !activePrompt ? (
          <Text dimColor>Waiting for output...</Text>
        ) : (
          displayLines.map((line, i) => (
            <Text key={i} color={line.isError ? 'red' : line.isStatus ? 'yellow' : undefined}>
              {line.text}
            </Text>
          ))
        )}

        {activePrompt && (
          <InlinePrompt message={activePrompt.message} options={activePrompt.options} onSelect={handlePromptSelect} />
        )}

        {hasScroll && (
          <Text dimColor>
            [{effectiveOffset + 1}-{Math.min(effectiveOffset + contentLines, lines.length)}/{lines.length}]
            {scrollOffset === null ? ' (following)' : ''}
          </Text>
        )}
      </Box>
      {hasScroll && (
        <Box flexDirection="column" width={1}>
          {Array.from({ length: contentLines }).map((_, i) => (
            <Text key={i} color={i >= scrollbarPosition && i < scrollbarPosition + scrollbarHeight ? 'cyan' : 'gray'}>
              {i >= scrollbarPosition && i < scrollbarPosition + scrollbarHeight ? '█' : '░'}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
