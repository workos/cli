/**
 * The full-screen installer: WorkOS logo and a rotating tips & news card up
 * top, the task list beside a plain-English walkthrough, any open question
 * below them, and a status line at the bottom.
 */

import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { RunModel } from './model/run-model.js';
import { useRunSnapshot, useTerminalSize } from './hooks.js';
import { colors, MIN_COLUMNS, MIN_ROWS } from './theme.js';
import { COMPACT_HEADER_ROWS, FULL_HEADER_ROWS, Header } from './components/Header.js';
import { TaskList } from './components/TaskList.js';
import { Walkthrough } from './components/Walkthrough.js';
import { PromptPanel, promptHeight } from './components/PromptPanel.js';
import { StatusBar } from './components/StatusBar.js';

export interface InstallerAppProps {
  model: RunModel;
  /** Answer the open prompt (a value or CANCEL). */
  answer: (value: unknown) => void;
  /** ctrl-c with no prompt open. */
  interrupt: () => void;
  projectName: string;
  tipIntervalMs?: number;
}

/** Rows at which the full-size logo fits alongside everything else. */
const FULL_LOGO_MIN_ROWS = 36;
const MIN_BODY_ROWS = 8;

// A fresh key per prompt so each question starts with empty input state.
const promptKeys = new WeakMap<object, number>();
let nextPromptKey = 0;
function keyFor(prompt: object): number {
  let key = promptKeys.get(prompt);
  if (key === undefined) promptKeys.set(prompt, (key = nextPromptKey++));
  return key;
}

export function InstallerApp({ model, answer, interrupt, projectName, tipIntervalMs = 12_000 }: InstallerAppProps) {
  const snapshot = useRunSnapshot(model);
  const [columns, rows] = useTerminalSize();
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTipIndex((i) => i + 1), tipIntervalMs);
    return () => clearInterval(timer);
  }, [tipIntervalMs]);

  // The open prompt owns the keyboard; otherwise ctrl-c cancels and ←/→ page tips.
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') interrupt();
      else if (key.rightArrow) setTipIndex((i) => i + 1);
      else if (key.leftArrow) setTipIndex((i) => i - 1);
    },
    { isActive: !snapshot.prompt },
  );

  const width = Math.max(20, columns - 2);
  const height = Math.max(1, rows - 1); // one short of the screen keeps Ink's redraw incremental
  const compact = rows < FULL_LOGO_MIN_ROWS;
  const headerRows = compact ? COMPACT_HEADER_ROWS : FULL_HEADER_ROWS;
  // Room for a select's options: what's left after the header, a minimal
  // body, the gaps, the rule, the question, and the status line.
  const maxOptions = Math.max(3, height - headerRows - MIN_BODY_ROWS - 6);
  const prompt = snapshot.prompt ? (
    <PromptPanel
      key={keyFor(snapshot.prompt)}
      request={snapshot.prompt}
      answer={answer}
      width={width}
      maxOptions={maxOptions}
    />
  ) : null;

  if (columns < MIN_COLUMNS || rows < MIN_ROWS) {
    return (
      <Box flexDirection="column" width={columns} height={height} paddingX={1}>
        <Text color={colors.brand} bold>
          WorkOS AuthKit installer
        </Text>
        <Text wrap="wrap">{`Make this window at least ${MIN_COLUMNS}×${MIN_ROWS} to see the installer (it's ${columns}×${rows}).`}</Text>
        <Box flexGrow={1} />
        {prompt}
        <StatusBar snapshot={snapshot} width={width} />
      </Box>
    );
  }

  const promptRows = snapshot.prompt ? promptHeight(snapshot.prompt, width, maxOptions) + 1 : 0;
  const bodyRows = Math.max(MIN_BODY_ROWS, height - headerRows - 1 - promptRows - 1);
  const taskWidth = columns >= 110 ? 34 : 30;
  const walkthroughWidth = width - taskWidth - 2;

  return (
    <Box flexDirection="column" width={columns} height={height} paddingX={1}>
      <Header snapshot={snapshot} columns={width} compact={compact} projectName={projectName} tipIndex={tipIndex} />
      <Box height={1} flexShrink={0} />
      <Box height={bodyRows} flexShrink={0}>
        <TaskList tasks={snapshot.tasks.filter((t) => t.status !== 'skipped')} width={taskWidth} height={bodyRows} />
        <Box width={2} flexShrink={0} />
        <Walkthrough entries={snapshot.walkthrough} width={walkthroughWidth} height={bodyRows} />
      </Box>
      {prompt ? <Box height={1} flexShrink={0} /> : null}
      {prompt}
      <Box flexGrow={1} />
      <StatusBar snapshot={snapshot} width={width} />
    </Box>
  );
}
