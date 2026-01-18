import React from 'react';
import { Box, Text } from 'ink';
import { useTerminalSize, MIN_COLUMNS, MIN_ROWS } from '../hooks/useTerminalSize.js';
import { Panel } from './Panel.js';
import { OutputPanel } from './OutputPanel.js';
import { AnimatedLogo } from './AnimatedLogo.js';
import type { WizardEventEmitter } from '../../lib/events.js';

interface DashboardLayoutProps {
  emitter: WizardEventEmitter;
  topPanelContent?: React.ReactNode;
}

export function DashboardLayout({
  emitter,
  topPanelContent,
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

  // Calculate explicit heights based on terminal size
  const topHeight = Math.floor(rows * 0.6);
  const bottomHeight = rows - topHeight;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {/* Top Panel - 60% height */}
      <Panel title="Changes" height={topHeight}>
        {topPanelContent || (
          <Text dimColor>No changes yet...</Text>
        )}
      </Panel>

      {/* Bottom Row - 40% height */}
      <Box flexDirection="row" height={bottomHeight}>
        {/* Bottom Left - 60% width */}
        <Panel title="Output" width="60%">
          <OutputPanel emitter={emitter} />
        </Panel>

        {/* Bottom Right - 40% width */}
        <Panel title="Status" width="40%">
          <Box alignItems="center" justifyContent="center" flexGrow={1}>
            <AnimatedLogo mode="spin" />
          </Box>
        </Panel>
      </Box>
    </Box>
  );
}
