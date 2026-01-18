import { diffLines } from 'diff';

export interface FileDiff {
  path: string;
  isNew: boolean;
  changes: DiffLine[];
  timestamp: number;
}

export interface DiffLine {
  type: 'add' | 'remove' | 'unchanged';
  content: string;
  lineNumber?: number;
}

export function computeDiff(
  path: string,
  oldContent: string | null,
  newContent: string,
): FileDiff {
  const isNew = oldContent === null || oldContent === '';

  if (isNew) {
    // New file - all lines are additions
    const lines = newContent.split('\n');
    return {
      path,
      isNew: true,
      changes: lines.map((content, i) => ({
        type: 'add' as const,
        content,
        lineNumber: i + 1,
      })),
      timestamp: Date.now(),
    };
  }

  // Compute unified diff
  const changes = diffLines(oldContent, newContent);
  const resultLines: DiffLine[] = [];
  let lineNumber = 1;

  for (const change of changes) {
    const lines = change.value.split('\n').filter(
      (l, i, arr) =>
        // Filter out empty last line from split
        i < arr.length - 1 || l !== '',
    );

    for (const line of lines) {
      if (change.added) {
        resultLines.push({
          type: 'add',
          content: line,
          lineNumber: lineNumber++,
        });
      } else if (change.removed) {
        resultLines.push({ type: 'remove', content: line });
      } else {
        resultLines.push({
          type: 'unchanged',
          content: line,
          lineNumber: lineNumber++,
        });
      }
    }
  }

  // Truncate very large diffs
  const MAX_LINES = 500;
  if (resultLines.length > MAX_LINES) {
    return {
      path,
      isNew: false,
      changes: [
        ...resultLines.slice(0, MAX_LINES),
        {
          type: 'unchanged' as const,
          content: `... (${resultLines.length - MAX_LINES} more lines)`,
        },
      ],
      timestamp: Date.now(),
    };
  }

  return {
    path,
    isNew: false,
    changes: resultLines,
    timestamp: Date.now(),
  };
}

// Helper: filter diff lines to show only changes with context
export function filterWithContext(
  changes: DiffLine[],
  contextLines: number,
): DiffLine[] {
  const result: DiffLine[] = [];
  const indices = new Set<number>();

  // Mark indices of changed lines and their context
  changes.forEach((change, i) => {
    if (change.type === 'add' || change.type === 'remove') {
      for (
        let j = Math.max(0, i - contextLines);
        j <= Math.min(changes.length - 1, i + contextLines);
        j++
      ) {
        indices.add(j);
      }
    }
  });

  // Build filtered result
  let lastIncluded = -2;
  for (let i = 0; i < changes.length; i++) {
    if (indices.has(i)) {
      if (lastIncluded < i - 1 && lastIncluded >= 0) {
        result.push({ type: 'unchanged', content: '...' });
      }
      result.push(changes[i]);
      lastIncluded = i;
    }
  }

  return result;
}

// Helper: format diff line with prefix
export function formatDiffLine(change: DiffLine): string {
  switch (change.type) {
    case 'add':
      return `+ ${change.content}`;
    case 'remove':
      return `- ${change.content}`;
    default:
      return `  ${change.content}`;
  }
}
