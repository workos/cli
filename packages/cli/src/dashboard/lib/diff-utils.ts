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

// Token types for syntax highlighting
export type TokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'type'
  | 'operator'
  | 'punctuation'
  | 'plain';

export interface Token {
  type: TokenType;
  value: string;
}

// Detect file language from path
export function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'css',
    html: 'html',
    md: 'markdown',
    env: 'env',
  };
  return langMap[ext] || 'plain';
}

// Keywords for JS/TS
const JS_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

// Tokenize a line of code for syntax highlighting
export function tokenize(line: string, language: string): Token[] {
  if (language === 'plain' || language === 'env') {
    // For .env files, highlight key=value
    if (language === 'env') {
      const match = line.match(/^(\w+)(=)(.*)$/);
      if (match) {
        return [
          { type: 'type', value: match[1] },
          { type: 'operator', value: match[2] },
          { type: 'string', value: match[3] },
        ];
      }
    }
    return [{ type: 'plain', value: line }];
  }

  const tokens: Token[] = [];
  let remaining = line;

  while (remaining.length > 0) {
    // Comments
    const commentMatch = remaining.match(/^(\/\/.*|\/\*[\s\S]*?\*\/)/);
    if (commentMatch) {
      tokens.push({ type: 'comment', value: commentMatch[1] });
      remaining = remaining.slice(commentMatch[1].length);
      continue;
    }

    // Strings (single, double, template)
    const stringMatch = remaining.match(
      /^("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/,
    );
    if (stringMatch) {
      tokens.push({ type: 'string', value: stringMatch[1] });
      remaining = remaining.slice(stringMatch[1].length);
      continue;
    }

    // JSX/HTML tags
    const tagMatch = remaining.match(/^(<\/?[A-Za-z][A-Za-z0-9]*)/);
    if (tagMatch) {
      tokens.push({ type: 'keyword', value: tagMatch[1] });
      remaining = remaining.slice(tagMatch[1].length);
      continue;
    }

    // Numbers
    const numberMatch = remaining.match(/^(\d+\.?\d*)/);
    if (numberMatch) {
      tokens.push({ type: 'number', value: numberMatch[1] });
      remaining = remaining.slice(numberMatch[1].length);
      continue;
    }

    // Identifiers and keywords
    const identMatch = remaining.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
    if (identMatch) {
      const word = identMatch[1];
      if (JS_KEYWORDS.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (word[0] === word[0].toUpperCase() && word !== word.toUpperCase()) {
        // PascalCase = likely a type or component
        tokens.push({ type: 'type', value: word });
      } else if (remaining.slice(word.length).match(/^\s*[(<]/)) {
        // Followed by ( or < = function call
        tokens.push({ type: 'function', value: word });
      } else {
        tokens.push({ type: 'plain', value: word });
      }
      remaining = remaining.slice(word.length);
      continue;
    }

    // Operators
    const opMatch = remaining.match(/^(=>|===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%=<>!&|^~?:])/);
    if (opMatch) {
      tokens.push({ type: 'operator', value: opMatch[1] });
      remaining = remaining.slice(opMatch[1].length);
      continue;
    }

    // Punctuation
    const punctMatch = remaining.match(/^([{}[\]();,.])/);
    if (punctMatch) {
      tokens.push({ type: 'punctuation', value: punctMatch[1] });
      remaining = remaining.slice(1);
      continue;
    }

    // Whitespace and other characters
    const wsMatch = remaining.match(/^(\s+)/);
    if (wsMatch) {
      tokens.push({ type: 'plain', value: wsMatch[1] });
      remaining = remaining.slice(wsMatch[1].length);
      continue;
    }

    // Single character fallback
    tokens.push({ type: 'plain', value: remaining[0] });
    remaining = remaining.slice(1);
  }

  return tokens;
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
