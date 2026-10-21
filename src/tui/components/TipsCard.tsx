import { Box, Text } from 'ink';
import type { Announcement, Tip } from '../content/index.js';
import type { RunSnapshot } from '../model/run-model.js';
import { colors, glyphs } from '../theme.js';
import { wrapText } from '../wrap.js';

export type Card = (Tip | Announcement) & { kind: 'news' | 'tip' };

/** Announcements first, then tips. */
export function cardsFor(snapshot: RunSnapshot): Card[] {
  return [
    ...snapshot.announcements.map((a) => ({ ...a, kind: 'news' as const })),
    ...snapshot.tips.map((t) => ({ ...t, kind: 'tip' as const })),
  ];
}

interface TipsCardProps {
  snapshot: RunSnapshot;
  /** Rotation position; wraps around the card count. */
  index: number;
  width: number;
  height: number;
  showLabel: boolean;
}

export function TipsCard({ snapshot, index, width, height, showLabel }: TipsCardProps) {
  const cards = cardsFor(snapshot);
  if (cards.length === 0 || height < 1) return null;
  const position = ((index % cards.length) + cards.length) % cards.length;
  const card = cards[position];

  // Budget: optional label, title, then body, command, and link as room allows.
  let room = height - (showLabel ? 1 : 0) - 1;
  const extras = [card.command, card.url].filter(Boolean).length;
  const bodyRoom = Math.max(room > extras ? 1 : 0, room - extras);
  const body = wrapText(card.body, width).slice(0, bodyRoom);
  room -= body.length;
  const command = card.command && room > 0 ? card.command : undefined;
  if (command) room--;
  const url = card.url && room > 0 ? card.url : undefined;

  return (
    <Box flexDirection="column" width={width}>
      {showLabel ? (
        <Text color={colors.muted} wrap="truncate-end">
          {`Tips & news  ${position + 1}/${cards.length}`}
        </Text>
      ) : null}
      <Text wrap="truncate-end">
        {card.kind === 'news' ? (
          <Text backgroundColor={colors.brand} color="white" bold>
            {' NEW '}
          </Text>
        ) : (
          <Text color={colors.brand}>{glyphs.tip}</Text>
        )}
        <Text bold>{` ${card.title}`}</Text>
      </Text>
      {body.map((line, i) => (
        <Text key={i} wrap="truncate-end">
          {line}
        </Text>
      ))}
      {command ? (
        <Text color={colors.link} wrap="truncate-end">
          {`$ ${command}`}
        </Text>
      ) : null}
      {url ? (
        <Text color={colors.muted} wrap="truncate-end">
          {url}
        </Text>
      ) : null}
    </Box>
  );
}
