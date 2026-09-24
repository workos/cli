import { Box, Text } from 'ink';
import type { WalkthroughEntry } from '../model/run-model.js';
import { colors, glyphs } from '../theme.js';
import { fitNewest, wrapText } from '../wrap.js';

const PREFIX_WIDTH = 2;

function prefix(entry: WalkthroughEntry): { glyph: string; color?: string } {
  if (entry.kind === 'narration' || entry.kind === 'notice') {
    if (entry.tone === 'success') return { glyph: glyphs.done, color: colors.success };
    if (entry.tone === 'warning') return { glyph: glyphs.warning, color: colors.warning };
    if (entry.tone === 'error') return { glyph: glyphs.failed, color: colors.error };
    return { glyph: glyphs.pointer, color: colors.brand };
  }
  return { glyph: glyphs.bullet, color: colors.muted };
}

function textColor(entry: WalkthroughEntry): string | undefined {
  if (entry.kind === 'notice') return entry.tone === 'error' ? colors.error : colors.warning;
  if (entry.kind === 'status') return colors.link;
  if (entry.kind === 'file' || entry.kind === 'command') return colors.muted;
  return undefined;
}

interface WalkthroughProps {
  entries: WalkthroughEntry[];
  width: number;
  height: number;
}

/** The newest entries that fit, oldest at the top, wrapped to the pane. */
export function Walkthrough({ entries, width, height }: WalkthroughProps) {
  const textWidth = Math.max(10, width - PREFIX_WIDTH);
  const visible = fitNewest(entries, (e) => wrapText(e.text, textWidth), Math.max(1, height - 1));

  return (
    <Box flexDirection="column" width={width} height={height} overflow="hidden">
      <Text bold>What's happening</Text>
      {visible.length === 0 ? <Text color={colors.muted}>Getting started…</Text> : null}
      {visible.flatMap(({ item, lines }) => {
        const { glyph, color } = prefix(item);
        return lines.map((line, i) => (
          <Text key={`${item.id}:${i}`} wrap="truncate-end">
            <Text color={color}>{i === 0 ? glyph : ' '}</Text>
            <Text color={textColor(item)}>{` ${line}`}</Text>
          </Text>
        ));
      })}
    </Box>
  );
}
