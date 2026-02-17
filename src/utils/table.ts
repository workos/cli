import chalk from 'chalk';

export interface TableColumn {
  header: string;
  width?: number;
}

export function formatTable(columns: TableColumn[], rows: string[][]): string {
  // Calculate column widths: max of header length, content length, or specified width
  const widths = columns.map((col, i) => {
    const contentMax = rows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return col.width ?? Math.max(col.header.length, contentMax);
  });

  const lines: string[] = [];

  // Header row
  const header = columns.map((col, i) => chalk.yellow(col.header.padEnd(widths[i]))).join('  ');
  lines.push(header);

  // Separator
  const totalWidth = widths.reduce((sum, w) => sum + w, 0) + (widths.length - 1) * 2;
  lines.push(chalk.dim('─'.repeat(totalWidth)));

  // Data rows
  for (const row of rows) {
    const line = row.map((cell, i) => (cell || '').padEnd(widths[i])).join('  ');
    lines.push(line);
  }

  return lines.join('\n');
}
