import { Box, Text } from 'ink';
import type { RunSnapshot } from '../model/run-model.js';
import { useSpinner } from '../hooks.js';
import { colors } from '../theme.js';

function hints(snapshot: RunSnapshot): string {
  if (snapshot.prompt?.kind === 'select') return '↑/↓ choose · enter select · esc cancel';
  if (snapshot.prompt?.kind === 'confirm') return 'y/n · enter default · esc cancel';
  if (snapshot.prompt) return 'enter submit · esc cancel';
  if (snapshot.outcome) return 'finishing up…';
  return '←/→ tips · ctrl-c cancel';
}

export function StatusBar({ snapshot, width }: { snapshot: RunSnapshot; width: number }) {
  const running = Boolean(snapshot.status) && !snapshot.prompt;
  const spinner = useSpinner(running);
  const help = hints(snapshot);
  const statusWidth = Math.max(0, width - help.length - 2);

  return (
    <Box width={width} height={1} flexShrink={0}>
      <Box width={statusWidth}>
        {running ? (
          <Text wrap="truncate-end">
            <Text color={colors.brand}>{spinner}</Text>
            <Text>{` ${snapshot.status}`}</Text>
          </Text>
        ) : null}
      </Box>
      <Box flexGrow={1} justifyContent="flex-end">
        <Text color={colors.muted} wrap="truncate-start">
          {help}
        </Text>
      </Box>
    </Box>
  );
}
