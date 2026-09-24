import { Box, Text } from 'ink';
import { compactLogoRows, logoRows, LOGO_WIDTH } from '../logo.js';
import { colors } from '../theme.js';
import type { RunSnapshot } from '../model/run-model.js';
import { TipsCard } from './TipsCard.js';

export const FULL_HEADER_ROWS = 10;
export const COMPACT_HEADER_ROWS = 5;
const GAP = 3;

interface HeaderProps {
  snapshot: RunSnapshot;
  columns: number;
  compact: boolean;
  projectName: string;
  tipIndex: number;
}

function Logo({ compact }: { compact: boolean }) {
  if (compact) {
    return (
      <Box flexDirection="column" width={LOGO_WIDTH} flexShrink={0}>
        {compactLogoRows().map((row, i) => (
          <Text key={i} color={colors.brand}>
            {row}
          </Text>
        ))}
      </Box>
    );
  }
  return (
    <Box flexDirection="column" width={LOGO_WIDTH} flexShrink={0}>
      {logoRows().map((runs, i) => (
        <Text key={i}>
          {runs.map((run, j) =>
            run.painted ? (
              <Text key={j} backgroundColor={colors.brand}>
                {run.text}
              </Text>
            ) : (
              <Text key={j}>{run.text}</Text>
            ),
          )}
        </Text>
      ))}
    </Box>
  );
}

export function Header({ snapshot, columns, compact, projectName, tipIndex }: HeaderProps) {
  const height = compact ? COMPACT_HEADER_ROWS : FULL_HEADER_ROWS;
  const width = Math.max(20, columns - LOGO_WIDTH - GAP);
  const where = [snapshot.framework, projectName].filter(Boolean).join(' · ');
  const title = (
    <Text wrap="truncate-end">
      <Text bold color={colors.brand}>
        WorkOS
      </Text>
      <Text bold> AuthKit installer</Text>
      {compact && where ? <Text color={colors.muted}>{`  ${where}`}</Text> : null}
    </Text>
  );

  return (
    <Box height={height} flexShrink={0}>
      <Logo compact={compact} />
      <Box width={GAP} flexShrink={0} />
      <Box flexDirection="column" width={width}>
        {title}
        {compact ? null : (
          <>
            <Text color={colors.muted} wrap="truncate-end">
              {where || ' '}
            </Text>
            <Text> </Text>
          </>
        )}
        <TipsCard
          snapshot={snapshot}
          index={tipIndex}
          width={width}
          height={compact ? height - 1 : height - 3}
          showLabel={!compact}
        />
      </Box>
    </Box>
  );
}
