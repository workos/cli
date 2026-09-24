import { useCallback, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ConfirmInput } from '@inkjs/ui';
import { CANCEL, type SelectOption, type UiLine, type UiPromptRequest, type ValidateFn } from '../../utils/ui.js';
import { colors, glyphs } from '../theme.js';
import { wrapText } from '../wrap.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const DEFAULT_VISIBLE_OPTIONS = 7;

type Answer = (value: unknown) => void;

/** Rows the panel draws: a rule, what the question is about, the question, then its input. */
export function promptHeight(
  request: UiPromptRequest,
  width: number,
  maxOptions = DEFAULT_VISIBLE_OPTIONS,
  maxContext = Number.POSITIVE_INFINITY,
): number {
  const rule = 1 + Math.min(request.context?.length ?? 0, maxContext);
  const question = wrapText(`? ${request.message.replace(ANSI, '')}`, Math.max(10, width)).length;
  switch (request.kind) {
    case 'confirm':
      return rule + question + 1;
    case 'select':
      return rule + question + visibleOptions(request, maxOptions);
    default:
      // the input, plus a line kept for a validation error
      return rule + question + 2;
  }
}

function visibleOptions(request: UiPromptRequest & { kind: 'select' }, maxOptions: number): number {
  return Math.max(1, Math.min(request.options.length, request.maxItems ?? DEFAULT_VISIBLE_OPTIONS, maxOptions));
}

function Question({ message, width, suffix }: { message: string; width: number; suffix?: string }) {
  return (
    <Box width={width}>
      <Text wrap="wrap">
        <Text color={colors.brand} bold>
          ?{' '}
        </Text>
        <Text bold>{message}</Text>
        {suffix ? <Text color={colors.muted}>{`  ${suffix}`}</Text> : null}
      </Text>
    </Box>
  );
}

function ConfirmPrompt({
  request,
  answer,
  width,
}: {
  request: UiPromptRequest & { kind: 'confirm' };
  answer: Answer;
  width: number;
}) {
  return (
    <Box flexDirection="column">
      <Question message={request.message} width={width} />
      <Text>
        {'  '}
        <ConfirmInput
          defaultChoice={request.initialValue === false ? 'cancel' : 'confirm'}
          onConfirm={() => answer(true)}
          onCancel={() => answer(false)}
        />
      </Text>
    </Box>
  );
}

function selectable(option: SelectOption<unknown>): boolean {
  return !option.disabled;
}

function SelectPrompt({
  request,
  answer,
  width,
  maxOptions,
}: {
  request: UiPromptRequest & { kind: 'select' };
  answer: Answer;
  width: number;
  maxOptions: number;
}) {
  const { options } = request;
  // Start on the initial value if it's selectable, else the first option that is.
  const preferred = options.findIndex((o) => selectable(o) && o.value === request.initialValue);
  const initial = preferred >= 0 ? preferred : Math.max(0, options.findIndex(selectable));
  const [focus, setFocus] = useState(initial);
  // Keys can arrive faster than Ink re-subscribes this handler after a render
  // (a fast ↓ then enter, or a paste), and a stale handler would pick the
  // option from before the move. The ref is always current.
  const focusRef = useRef(initial);
  const visibleCount = visibleOptions(request, maxOptions);
  const start = Math.min(Math.max(0, focus - visibleCount + 1), Math.max(0, options.length - visibleCount));

  const move = (step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (focusRef.current + step * i + options.length) % options.length;
      if (selectable(options[next])) {
        focusRef.current = next;
        setFocus(next);
        return;
      }
    }
  };

  useInput((input, key) => {
    const current = focusRef.current;
    if (key.upArrow || input === 'k') move(-1);
    else if (key.downArrow || input === 'j') move(1);
    else if (key.return && selectable(options[current])) answer(options[current].value);
  });

  return (
    <Box flexDirection="column">
      <Question message={request.message} width={width} />
      {options.slice(start, start + visibleCount).map((option, i) => {
        const index = start + i;
        const focused = index === focus;
        const label = option.label ?? String(option.value);
        const note = typeof option.disabled === 'string' ? option.disabled : option.hint;
        return (
          <Text key={index} wrap="truncate-end">
            <Text color={colors.brand}>{focused ? `${glyphs.pointer} ` : '  '}</Text>
            <Text bold={focused} color={option.disabled ? colors.muted : focused ? colors.brand : undefined}>
              {label}
            </Text>
            {note ? <Text color={colors.muted}>{`  ${note}`}</Text> : null}
          </Text>
        );
      })}
    </Box>
  );
}

/**
 * A one-line text input that can't drop keys.
 *
 * @inkjs/ui's TextInput keeps its value in state that only catches up after a
 * render, so keys arriving faster than that (typing ahead, a paste) read a
 * stale value, and a paste ending in a newline was inserted as text instead of
 * submitting. Here the value lives in a ref that every key reads and writes
 * immediately, and a newline anywhere in a chunk submits what precedes it.
 */
function LineInput({
  mask,
  placeholder,
  onChange,
  onSubmit,
}: {
  mask?: string;
  placeholder?: string;
  onChange: () => void;
  onSubmit: (value: string) => void;
}) {
  const [shown, setShown] = useState({ value: '', cursor: 0 });
  const state = useRef(shown);
  const set = (next: { value: string; cursor: number }) => {
    state.current = next;
    setShown(next);
    onChange();
  };

  // The cursor counts characters (code points), so an emoji is one step.
  useInput((input, key) => {
    const { value, cursor } = state.current;
    const chars = Array.from(value);
    if (key.return) return onSubmit(value);
    if (key.leftArrow) return set({ value, cursor: Math.max(0, cursor - 1) });
    if (key.rightArrow) return set({ value, cursor: Math.min(chars.length, cursor + 1) });
    if (key.backspace || key.delete) {
      if (cursor > 0) {
        chars.splice(cursor - 1, 1);
        set({ value: chars.join(''), cursor: cursor - 1 });
      }
      return;
    }
    if (!input || key.ctrl || key.meta || key.escape || key.tab || key.upArrow || key.downArrow) return;
    // A key Ink doesn't name (Home, End, F-keys) arrives as its escape sequence.
    if (input.startsWith('\x1b')) return;
    const newline = input.search(/[\r\n]/);
    const typed = Array.from(newline >= 0 ? input.slice(0, newline) : input);
    chars.splice(cursor, 0, ...typed);
    const next = { value: chars.join(''), cursor: cursor + typed.length };
    set(next);
    if (newline >= 0) onSubmit(next.value);
  });

  const { value, cursor } = shown;
  if (!value && placeholder) {
    return (
      <Text>
        <Text inverse>{placeholder[0]}</Text>
        <Text color={colors.muted}>{placeholder.slice(1)}</Text>
      </Text>
    );
  }
  const chars = Array.from(value).map((c) => mask ?? c);
  return (
    <Text>
      {chars.slice(0, cursor).join('')}
      <Text inverse>{chars[cursor] ?? ' '}</Text>
      {chars.slice(cursor + 1).join('')}
    </Text>
  );
}

function TextPrompt({
  request,
  answer,
  width,
}: {
  request: UiPromptRequest & { kind: 'text' | 'password' };
  answer: Answer;
  width: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback(() => setError(null), []);
  const fallback = request.kind === 'text' ? (request.defaultValue ?? request.initialValue) : undefined;
  const placeholder = request.kind === 'text' ? (request.placeholder ?? fallback) : undefined;

  const submit = async (typed: string) => {
    const value = typed === '' && fallback !== undefined ? fallback : typed;
    let verdict: unknown;
    try {
      verdict = await (request.validate as ValidateFn | undefined)?.(value);
    } catch (error) {
      // A validator that throws is saying no; it mustn't crash the installer.
      verdict = error;
    }
    if (verdict != null) {
      setError(verdict instanceof Error ? verdict.message : String(verdict));
      return;
    }
    answer(value);
  };

  return (
    <Box flexDirection="column">
      <Question message={request.message} width={width} />
      <Box>
        <Text color={colors.brand}>{`${glyphs.pointer} `}</Text>
        <LineInput
          mask={request.kind === 'password' ? '*' : undefined}
          placeholder={placeholder}
          onChange={clearError}
          onSubmit={(value) => void submit(value)}
        />
      </Box>
      <Text color={colors.error} wrap="truncate-end">
        {error ? `${glyphs.failed} ${error}` : ' '}
      </Text>
    </Box>
  );
}

/** Context lines, trimmed to `max` rows with the overflow counted on the last one. */
function PromptContext({ context, max }: { context: readonly UiLine[]; max: number }) {
  if (context.length === 0 || max < 1) return null;
  const fits = context.length <= max;
  const shown = fits ? context : context.slice(0, max - 1);
  const hidden = context.length - shown.length;
  return (
    <>
      {shown.map((line, i) => (
        <Text key={i} wrap="truncate-end">
          {line.rendered}
        </Text>
      ))}
      {hidden > 0 ? <Text color={colors.muted}>{`  … ${hidden} more`}</Text> : null}
    </>
  );
}

interface PromptPanelProps {
  request: UiPromptRequest;
  answer: Answer;
  width: number;
  /** Most option rows a select may show in the space available. */
  maxOptions?: number;
  /** Most rows of context above the question; the rest collapse into "… N more". */
  maxContext?: number;
}

export function PromptPanel({
  request,
  answer,
  width,
  maxOptions = DEFAULT_VISIBLE_OPTIONS,
  maxContext = Number.POSITIVE_INFINITY,
}: PromptPanelProps) {
  // Esc cancels, and so does ctrl-c while a question is open, the same as the
  // plain CLI's prompts.
  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'c')) answer(CANCEL);
  });

  let body;
  switch (request.kind) {
    case 'confirm':
      body = <ConfirmPrompt request={request} answer={answer} width={width} />;
      break;
    case 'select':
      body = <SelectPrompt request={request} answer={answer} width={width} maxOptions={maxOptions} />;
      break;
    default:
      body = <TextPrompt request={request} answer={answer} width={width} />;
  }

  return (
    <Box flexDirection="column" width={width} flexShrink={0}>
      <Text color={colors.brand}>{'─'.repeat(Math.max(1, width))}</Text>
      {/* What the caller printed before asking, e.g. the files behind "Continue anyway?" */}
      <PromptContext context={request.context ?? []} max={maxContext} />
      {body}
    </Box>
  );
}
