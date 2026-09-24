import { Box, Text } from 'ink';
import { countedTasks, type SubtaskView, type TaskStatus, type TaskView } from '../model/run-model.js';
import { colors, glyphs } from '../theme.js';
import { useSpinner } from '../hooks.js';

/** One line of the list: a task or, indented under it, one of its sub-steps. */
interface Row {
  key: string;
  label: string;
  status: TaskStatus;
  indent: boolean;
}

function rowsFor(tasks: TaskView[]): Row[] {
  return tasks.flatMap((task) => [
    {
      key: task.id,
      label: task.status === 'in_progress' && task.activeLabel ? task.activeLabel : task.label,
      status: task.status,
      indent: false,
    },
    ...(task.subtasks ?? []).map((sub: SubtaskView) => ({
      key: `${task.id}/${sub.id}`,
      label: sub.label,
      status: sub.status,
      indent: true,
    })),
  ]);
}

function TaskRow({ row, spinner }: { row: Row; spinner: string }) {
  const pad = row.indent ? '  ' : '';
  switch (row.status) {
    case 'completed':
      return (
        <Text wrap="truncate-end">
          {pad}
          <Text color={colors.success}>{glyphs.done}</Text> {row.label}
        </Text>
      );
    case 'in_progress':
      return (
        <Text wrap="truncate-end" bold={!row.indent}>
          {pad}
          <Text color={colors.brand}>{spinner}</Text> {row.label}
        </Text>
      );
    case 'next':
      return (
        <Text wrap="truncate-end" bold color={colors.brand}>
          {pad}
          {glyphs.next} {row.label}
        </Text>
      );
    case 'failed':
      return (
        <Text wrap="truncate-end" color={colors.error}>
          {pad}
          {glyphs.failed} {row.label}
        </Text>
      );
    case 'attention':
      return (
        <Text wrap="truncate-end" color={colors.warning}>
          {pad}
          {glyphs.warning} {row.label}
        </Text>
      );
    case 'cancelled':
      return (
        <Text wrap="truncate-end" color={colors.warning}>
          {pad}
          {glyphs.cancelled} {row.label}
        </Text>
      );
    case 'skipped':
      return (
        <Text wrap="truncate-end" color={colors.muted}>
          {pad}
          {glyphs.skipped} {row.label}
        </Text>
      );
    default:
      return (
        <Text wrap="truncate-end" color={colors.muted}>
          {pad}
          {glyphs.pending} {row.label}
        </Text>
      );
  }
}

/**
 * The task list, fitted to `height`: the heading and counter go first when
 * space is short, then it shows a window of rows around the current one.
 */
export function TaskList({ tasks, width, height }: { tasks: TaskView[]; width: number; height: number }) {
  const rows = rowsFor(tasks);
  const running = rows.some((r) => r.status === 'in_progress');
  const spinner = useSpinner(running);
  const counted = countedTasks(tasks);
  const done = counted.filter((t) => t.status === 'completed').length;

  const showTitle = height >= rows.length + 2;
  const showCount = height >= rows.length + (showTitle ? 1 : 0) + 1;
  const room = Math.max(1, height - (showTitle ? 1 : 0) - (showCount ? 1 : 0));
  // Keep the deepest running row in view (a sub-step over its parent).
  const lastRunning = rows.map((r) => r.status).lastIndexOf('in_progress');
  const current =
    lastRunning >= 0
      ? lastRunning
      : Math.max(
          0,
          rows.findIndex((r) => r.status === 'pending'),
        );
  const start = Math.min(Math.max(0, current - 1), Math.max(0, rows.length - room));

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      {showTitle ? <Text bold>Tasks</Text> : null}
      {rows.slice(start, start + room).map((row) => (
        <TaskRow key={row.key} row={row} spinner={spinner} />
      ))}
      {showCount ? <Text color={colors.muted}>{`${done} of ${counted.length} done`}</Text> : null}
    </Box>
  );
}

/**
 * The task list as one line, for terminals too small to show it beside the
 * walkthrough: where the run is and how much is done.
 */
export function ProgressLine({ tasks, width }: { tasks: TaskView[]; width: number }) {
  const counted = countedTasks(tasks);
  const done = counted.filter((t) => t.status === 'completed').length;
  const count = `${done} of ${counted.length} done`;
  const active = tasks.find((t) => t.status === 'in_progress');
  const failed = tasks.find((t) => t.status === 'failed' || t.status === 'cancelled');
  const next = tasks.find((t) => t.status === 'next');
  const spinner = useSpinner(Boolean(active));

  let line;
  if (active) {
    const sub = active.subtasks?.filter((s) => s.status === 'in_progress').at(-1);
    const label = `${active.activeLabel ?? active.label}${sub ? ` · ${sub.label}` : ''}`;
    line = (
      <Text wrap="truncate-end">
        <Text color={colors.brand}>{spinner}</Text>
        <Text bold>{` ${label}`}</Text>
        <Text color={colors.muted}>{` · ${count}`}</Text>
      </Text>
    );
  } else if (failed) {
    const cancelled = failed.status === 'cancelled';
    line = (
      <Text wrap="truncate-end" color={cancelled ? colors.warning : colors.error}>
        {`${cancelled ? glyphs.cancelled : glyphs.failed} ${failed.label} ${cancelled ? 'cancelled' : 'failed'}`}
        <Text color={colors.muted}>{` · ${count}`}</Text>
      </Text>
    );
  } else if (next) {
    // Done, unless a WorkOS setting still needs a look in the dashboard.
    const check = tasks.some((t) => t.subtasks?.some((s) => s.status === 'attention' || s.status === 'failed'));
    line = (
      <Text wrap="truncate-end">
        {check ? (
          <Text color={colors.warning}>{`${glyphs.warning} Check your WorkOS settings`}</Text>
        ) : (
          <Text color={colors.success}>{`${glyphs.done} All done`}</Text>
        )}
        <Text bold color={colors.brand}>{` · ${glyphs.next} ${next.label}`}</Text>
      </Text>
    );
  } else {
    line = <Text color={colors.muted} wrap="truncate-end">{`${glyphs.pending} ${count}`}</Text>;
  }

  return (
    <Box width={width} height={1} flexShrink={0}>
      {line}
    </Box>
  );
}
