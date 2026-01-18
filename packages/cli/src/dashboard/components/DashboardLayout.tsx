import React from 'react';
import { Box, Text } from 'ink';
import { useTerminalSize, MIN_COLUMNS, MIN_ROWS } from '../hooks/useTerminalSize.js';
import { Panel } from './Panel.js';
import { OutputPanel } from './OutputPanel.js';
import { DiffPanel } from './DiffPanel.js';
import { AnimatedLogo } from './AnimatedLogo.js';
import type { WizardEventEmitter } from '../../lib/events.js';

type FocusedPanel = 'changes' | 'output';

interface DashboardLayoutProps {
  emitter: WizardEventEmitter;
  focusedPanel?: FocusedPanel;
}

export function DashboardLayout({
  emitter,
  focusedPanel = 'changes',
}: DashboardLayoutProps): React.ReactElement {
  const { columns, rows } = useTerminalSize();

  // Check minimum size
  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="yellow">Terminal too small</Text>
        <Text dimColor>
          Minimum size: {MIN_COLUMNS}x{MIN_ROWS}
        </Text>
        <Text dimColor>
          Current size: {columns}x{rows}
        </Text>
      </Box>
    );
  }

  // Calculate explicit heights - reserve 1 row for help hint
  const availableRows = rows - 1;
  const topHeight = Math.floor(availableRows * 0.6);
  const bottomHeight = availableRows - topHeight;

  // Calculate widths for bottom panels
  const outputWidth = Math.floor(columns * 0.75);
  const statusWidth = columns - outputWidth;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {/* Top Panel - 60% height */}
      <Panel
        title="Changes"
        height={topHeight}
        borderColor={focusedPanel === 'changes' ? 'cyan' : 'gray'}
        contentHeight={topHeight - 4}
      >
        <DiffPanel
          emitter={emitter}
          focused={focusedPanel === 'changes'}
          height={topHeight - 4}
        />
      </Panel>

      {/* Bottom Row */}
      <Box flexDirection="row" height={bottomHeight}>
        {/* Bottom Left - 75% width */}
        <Panel
          title="Output"
          width={outputWidth}
          borderColor={focusedPanel === 'output' ? 'cyan' : 'gray'}
          contentHeight={bottomHeight - 4}
        >
          <OutputPanel
            emitter={emitter}
            focused={focusedPanel === 'output'}
            height={bottomHeight - 4}
          />
        </Panel>

        {/* Bottom Right - 25% width, no title */}
        <Panel width={statusWidth}>
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <AnimatedLogo mode="spin" />
          </Box>
        </Panel>
      </Box>

      {/* Help hint at bottom */}
      <Box>
        <Text dimColor> Tab: switch panel | j/k: scroll | gg/G: top/bottom</Text>
      </Box>
    </Box>
  );
}
