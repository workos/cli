import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Box, Text, useStdout, useInput } from 'ink';
import type { WizardEventEmitter } from '../../lib/events.js';
import { WelcomeArt } from './WelcomeArt.js';
import {
  computeDiff,
  filterWithContext,
  formatDiffLine,
  type FileDiff,
} from '../lib/diff-utils.js';

interface DiffPanelProps {
  emitter: WizardEventEmitter;
  focused?: boolean;
  height?: number;
}

export function DiffPanel({ emitter, focused = true, height }: DiffPanelProps): React.ReactElement {
  const [diffs, setDiffs] = useState<FileDiff[]>([]);
  const [scrollOffset, setScrollOffset] = useState(0);
  const lastKeyRef = useRef<string>('');
  const { stdout } = useStdout();
  // Use provided height or fall back to calculated height
  const visibleLines = height ?? Math.floor((stdout?.rows || 24) * 0.55) - 4;

  useEffect(() => {
    const handleWrite = ({ path, content }: { path: string; content: string }) => {
      const diff = computeDiff(path, null, content);
      setDiffs((prev) => [diff, ...prev].slice(0, 10));
      setScrollOffset(0);
    };

    const handleEdit = ({
      path,
      oldContent,
      newContent,
    }: {
      path: string;
      oldContent: string;
      newContent: string;
    }) => {
      const diff = computeDiff(path, oldContent, newContent);
      setDiffs((prev) => [diff, ...prev].slice(0, 10));
      setScrollOffset(0);
    };

    emitter.on('file:write', handleWrite);
    emitter.on('file:edit', handleEdit);

    return () => {
      emitter.off('file:write', handleWrite);
      emitter.off('file:edit', handleEdit);
    };
  }, [emitter]);

  // Flatten all diffs for display
  const allLines = useMemo(() => {
    const lines: Array<{
      type: 'header' | 'add' | 'remove' | 'unchanged';
      content: string;
    }> = [];

    for (const diff of diffs) {
      lines.push({
        type: 'header',
        content: `── ${diff.path} ${diff.isNew ? '(new file)' : '(modified)'} ──`,
      });

      const filteredChanges = filterWithContext(diff.changes, 3);
      for (const change of filteredChanges) {
        lines.push({ type: change.type, content: formatDiffLine(change) });
      }

      lines.push({ type: 'unchanged', content: '' });
    }

    return lines;
  }, [diffs]);

  // Vim-style keyboard navigation (only when focused)
  useInput((input, key) => {
    if (!focused || diffs.length === 0) return;

    const maxOffset = Math.max(0, allLines.length - visibleLines);
    const halfPage = Math.floor(visibleLines / 2);

    // j/k or arrow keys for line-by-line
    if (input === 'j' || key.downArrow) {
      setScrollOffset((prev) => Math.min(maxOffset, prev + 1));
    } else if (input === 'k' || key.upArrow) {
      setScrollOffset((prev) => Math.max(0, prev - 1));
    }
    // Ctrl-d / Ctrl-u for half-page
    else if (key.ctrl && input === 'd') {
      setScrollOffset((prev) => Math.min(maxOffset, prev + halfPage));
    } else if (key.ctrl && input === 'u') {
      setScrollOffset((prev) => Math.max(0, prev - halfPage));
    }
    // G for bottom, gg for top
    else if (input === 'G') {
      setScrollOffset(maxOffset);
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

  // Show welcome art if no diffs yet
  if (diffs.length === 0) {
    return <WelcomeArt />;
  }

  // Reserve 1 line for scroll indicator if needed
  const hasScroll = allLines.length > visibleLines - 1;
  const contentLines = hasScroll ? visibleLines - 1 : visibleLines;
  const displayLines = allLines.slice(scrollOffset, scrollOffset + contentLines);
  const maxOffset = Math.max(0, allLines.length - contentLines);

  // Calculate scrollbar position
  const scrollbarHeight = Math.max(1, Math.floor((contentLines / allLines.length) * contentLines));
  const scrollbarPosition = maxOffset > 0
    ? Math.floor((scrollOffset / maxOffset) * (contentLines - scrollbarHeight))
    : 0;

  return (
    <Box flexDirection="row" flexGrow={1}>
      <Box flexDirection="column" flexGrow={1}>
        {displayLines.map((line, i) => (
          <Text
            key={i}
            color={
              line.type === 'header'
                ? 'cyan'
                : line.type === 'add'
                  ? 'green'
                  : line.type === 'remove'
                    ? 'red'
                    : undefined
            }
            bold={line.type === 'header'}
          >
            {line.content}
          </Text>
        ))}
        {hasScroll && (
          <Text dimColor>
            [{scrollOffset + 1}-{Math.min(scrollOffset + contentLines, allLines.length)}/{allLines.length}]
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
