import { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ConfirmInput, PasswordInput, TextInput } from '@inkjs/ui';
import { CANCEL, type SelectOption, type UiPromptRequest, type ValidateFn } from '../../utils/ui.js';
import { colors, glyphs } from '../theme.js';
import { wrapText } from '../wrap.js';

const ANSI = /\x1b\[[0-9;]*m/g;
const DEFAULT_VISIBLE_OPTIONS = 7;

type Answer = (value: unknown) => void;

/** Rows the panel draws: a rule, the wrapped question, then its input. */
export function promptHeight(request: UiPromptRequest, width: number, maxOptions = DEFAULT_VISIBLE_OPTIONS): number {
  const rule = 1;
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
  const visibleCount = visibleOptions(request, maxOptions);
  const start = Math.min(Math.max(0, focus - visibleCount + 1), Math.max(0, options.length - visibleCount));

  const move = (step: number) => {
    for (let i = 1; i <= options.length; i++) {
      const next = (focus + step * i + options.length) % options.length;
      if (selectable(options[next])) {
        setFocus(next);
        return;
      }
    }
  };

  useInput((input, key) => {
    if (key.upArrow || input === 'k') move(-1);
    else if (key.downArrow || input === 'j') move(1);
    else if (key.return && selectable(options[focus])) answer(options[focus].value);
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
  // Must be stable: @inkjs/ui calls onChange from an effect keyed on its
  // identity, so a fresh function each render would clear the error it just set.
  const clearError = useCallback(() => setError(null), []);
  const fallback = request.kind === 'text' ? (request.defaultValue ?? request.initialValue) : undefined;
  const placeholder = request.kind === 'text' ? (request.placeholder ?? fallback) : undefined;

  const submit = async (typed: string) => {
    const value = typed === '' && fallback !== undefined ? fallback : typed;
    const verdict = await (request.validate as ValidateFn | undefined)?.(value);
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
        {request.kind === 'password' ? (
          <PasswordInput onChange={clearError} onSubmit={submit} />
        ) : (
          <TextInput placeholder={placeholder} onChange={clearError} onSubmit={submit} />
        )}
      </Box>
      <Text color={colors.error} wrap="truncate-end">
        {error ? `${glyphs.failed} ${error}` : ' '}
      </Text>
    </Box>
  );
}

interface PromptPanelProps {
  request: UiPromptRequest;
  answer: Answer;
  width: number;
  /** Most option rows a select may show in the space available. */
  maxOptions?: number;
}

export function PromptPanel({ request, answer, width, maxOptions = DEFAULT_VISIBLE_OPTIONS }: PromptPanelProps) {
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
      {body}
    </Box>
  );
}
