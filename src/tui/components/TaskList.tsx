import { Box, Text } from 'ink';
import type { TaskView } from '../model/run-model.js';
import { colors, glyphs } from '../theme.js';
import { useSpinner } from '../hooks.js';

function TaskRow({ task, spinner }: { task: TaskView; spinner: string }) {
  const label = task.status === 'in_progress' && task.activeLabel ? task.activeLabel : task.label;
  switch (task.status) {
    case 'completed':
      return (
        <Text wrap="truncate-end">
          <Text color={colors.success}>{glyphs.done}</Text> {label}
        </Text>
      );
    case 'in_progress':
      return (
        <Text wrap="truncate-end" bold>
          <Text color={colors.brand}>{spinner}</Text> {label}
        </Text>
      );
    case 'failed':
      return (
        <Text wrap="truncate-end" color={colors.error}>
          {glyphs.failed} {label}
        </Text>
      );
    case 'cancelled':
      return (
        <Text wrap="truncate-end" color={colors.warning}>
          {glyphs.cancelled} {label}
        </Text>
      );
    case 'skipped':
      return (
        <Text wrap="truncate-end" color={colors.muted}>
          {glyphs.skipped} {label}
        </Text>
      );
    default:
      return (
        <Text wrap="truncate-end" color={colors.muted}>
          {glyphs.pending} {label}
        </Text>
      );
  }
}

/**
 * The task list, fitted to `height`: the heading and counter go first when
 * space is short, then it shows a window of tasks around the current one.
 */
export function TaskList({ tasks, width, height }: { tasks: TaskView[]; width: number; height: number }) {
  const running = tasks.some((t) => t.status === 'in_progress');
  const spinner = useSpinner(running);
  const counted = tasks.filter((t) => t.status !== 'skipped');
  const done = counted.filter((t) => t.status === 'completed').length;

  const showTitle = height >= tasks.length + 2;
  const showCount = height >= tasks.length + (showTitle ? 1 : 0) + 1;
  const rows = Math.max(1, height - (showTitle ? 1 : 0) - (showCount ? 1 : 0));
  const current = Math.max(
    0,
    tasks.findIndex((t) => t.status === 'in_progress' || t.status === 'pending'),
  );
  const start = Math.min(Math.max(0, current - 1), Math.max(0, tasks.length - rows));

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {showTitle ? <Text bold>Tasks</Text> : null}
      {tasks.slice(start, start + rows).map((task) => (
        <TaskRow key={task.id} task={task} spinner={spinner} />
      ))}
      {showCount ? <Text color={colors.muted}>{`${done} of ${counted.length} done`}</Text> : null}
    </Box>
  );
}
