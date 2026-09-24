/**
 * UI facade — flat, gutterless CLI output + interactive prompts.
 *
 * The single import seam for all CLI UI: every module imports the default `ui`
 * from this file. Output is hand-styled ANSI (diffdad-style: 2-space indent, one
 * accent color, no vertical gutter). Input (confirm/select/text/password)
 * delegates to `@inquirer/prompts`.
 *
 * The prompt adapters keep a stable call shape (`{ message, options,
 * initialValue, validate }`) and the `isCancel(answer)` pattern, so the input
 * engine can be swapped underneath without touching the ~30 call sites.
 *
 * Cancellation: @inquirer THROWS on ctrl-c / signal-abort (ExitPromptError /
 * AbortPromptError) instead of returning a symbol. Each adapted prompt catches
 * those and returns the `CANCEL` symbol, so `if (ui.isCancel(x))` keeps working.
 */

import chalk from 'chalk';
import { isJsonMode } from './output.js';
import { palette } from './cli-symbols.js';

// @inquirer/prompts is loaded lazily (inside each prompt fn) so the barrel — all
// ten widgets — stays off every non-interactive path (--json, --version, --help,
// resource commands), which is most invocations. import() is module-cached, so
// only the first prompt pays.

// ── UI host ─────────────────────────────────────────────────────────────────
// A host (the full-screen installer) takes over where output and prompts go.
// With no host, everything below prints to the terminal exactly as before.

/** The log level a line was printed at, so a host can style or surface it. */
export type UiLineKind = 'plain' | 'info' | 'step' | 'success' | 'warn' | 'error' | 'hint' | 'detail';

export interface UiLine {
  kind: UiLineKind;
  /** The caller's text, unstyled. Empty for a blank line. */
  message: string;
  /** The styled line ui would have printed, without the leading indent. */
  rendered: string;
  /** Where the line would have gone. */
  stream: 'stdout' | 'stderr';
}

export type UiPromptRequest = (
  | ({ kind: 'confirm' } & ConfirmOptions)
  | ({ kind: 'select' } & SelectOptions<unknown>)
  | ({ kind: 'text' } & TextOptions)
  | ({ kind: 'password' } & PasswordOptions)
) & {
  /**
   * What the caller printed right before asking (same synchronous run), e.g.
   * the file list behind "Continue anyway?". On a terminal those lines sit
   * above the question; a host has to show them with it. Absent when empty.
   */
  context?: readonly UiLine[];
};

export interface UiHost {
  /** A line ui would have printed. */
  line(line: UiLine): void;
  /** The running spinner's message, or null when no spinner is running. */
  status(message: string | null): void;
  /**
   * Answer a prompt: a boolean for confirm, the chosen option's value for
   * select, a string for text/password, or CANCEL. Must resolve CANCEL when
   * `request.signal` aborts. Only one prompt is open at a time.
   */
  prompt(request: UiPromptRequest): Promise<unknown>;
}

let uiHost: UiHost | null = null;

/** Route all ui output and prompts to `host`, or back to the terminal with null. */
export function setUiHost(host: UiHost | null): void {
  uiHost = host;
}

export function getUiHost(): UiHost | null {
  return uiHost;
}

// Brand palette (shared with summary-box via cli-symbols). chalk auto-disables
// color when chalk.level === 0, set by setOutputMode in JSON mode.
const { accent, green, red, yellow, cyan } = palette;
const { dim, bold } = chalk;

/**
 * An inverse "badge" chip (e.g. a colored INFO / WARN label). Pure string
 * helper so callers writing to stdout OR stderr can reuse it. chalk.level === 0
 * (JSON mode) strips the color to plain text automatically.
 */
export function pill(label: string, kind: 'info' | 'warn' = 'info'): string {
  const text = ` ${label} `;
  return kind === 'warn' ? chalk.bgHex('#fbbf24').black(text) : chalk.bgHex('#6363f1').white(text);
}

const INDENT = '  ';

// Every stdout write routes through emit(), the single point where a UI host
// takes over — so no output surface below has to check for one.
function emit(kind: UiLineKind, message: string, rendered: string, terminal = INDENT + rendered): void {
  if (uiHost) {
    const line: UiLine = { kind, message, rendered, stream: 'stdout' };
    rememberForPrompt(line);
    uiHost.line(line);
    return;
  }
  console.log(terminal);
}

// Callers print what a question is about, then ask, in one synchronous run
// ("You have uncommitted files:" + the list, then "Continue anyway?"). With a
// host, keep this run's lines so a prompt called in it can carry them as
// context. The next microtask clears them, so earlier output never leaks in.
const MAX_PROMPT_CONTEXT = 8;
let recentLines: UiLine[] = [];
let recentClearScheduled = false;

function rememberForPrompt(line: UiLine): void {
  if (!line.message.trim()) return;
  recentLines.push(line);
  if (!recentClearScheduled) {
    recentClearScheduled = true;
    queueMicrotask(() => {
      recentLines = [];
      recentClearScheduled = false;
    });
  }
}

/** Claim this run's lines for the prompt being called now. */
function takePromptContext(): { context?: readonly UiLine[] } {
  if (!uiHost || recentLines.length === 0) return {};
  const context = recentLines.slice(-MAX_PROMPT_CONTEXT);
  recentLines = [];
  return { context };
}

/** Print one indented line to stdout. */
function line(text = ''): void {
  emit('plain', text, text);
}

/** Print a vertical blank line. */
function blank(): void {
  emit('plain', '', '', '');
}

// ── Output surface ───────────────────────────────────────────────────────────

/**
 * Branded title line, framed by blank lines. With a subtitle it renders
 * `Title · subtitle` (accent-bold name, dim subtitle) — the dad-style header.
 */
function intro(title: string, subtitle?: string): void {
  blank();
  line(subtitle ? `${accent(bold(title))}  ${dim('·')}  ${dim(subtitle)}` : accent(bold(title)));
  blank();
}

/** Closing line. */
function outro(message = ''): void {
  blank();
  if (message) line(dim(message));
  blank();
}

/** A titled section header — anchors a "moment" that owns several lines. */
function heading(title: string): void {
  blank();
  line(accent(bold(title)));
}

/** Multi-line indented note (body dim, framed by blank lines). */
function note(message: string): void {
  blank();
  for (const l of String(message).split('\n')) line(dim(l));
  blank();
}

const log = {
  info: (m: string) => emit('info', m, m),
  step: (m: string) => emit('step', m, `${accent('›')} ${m}`),
  success: (m: string) => emit('success', m, `${green('✓')} ${m}`),
  warn: (m: string) => emit('warn', m, `${yellow('!')} ${m}`),
  warning: (m: string) => emit('warn', m, `${yellow('!')} ${m}`),
  error: (m: string) => emit('error', m, `${red('✗')} ${m}`),
  /** A muted, low-priority aside (opt-out hints, "run X later"). One dim line. */
  hint: (m: string) => emit('hint', m, dim(m)),
  /** A nested sub-step, indented one level under its parent line. */
  detail: (m: string) => emit('detail', m, `  ${dim('›')} ${dim(m)}`),
};

// ── Aligned key/value rows ────────────────────────────────────────────────────

export type RowStatusKind = 'ok' | 'muted' | 'warn';
export interface Row {
  key: string;
  value: string;
  /** Optional trailing status word (e.g. "created", "already set", "updated"). */
  status?: string;
  /** How to color the status word. Defaults to 'muted'. */
  statusKind?: RowStatusKind;
}

/**
 * Print a set of aligned key/value rows (leading ✓, dim key padded to the
 * widest key in the set, accent value, optional colored status). Alignment is a
 * property of the whole set, so callers pass every row at once.
 */
function rows(items: Row[]): void {
  if (items.length === 0) return;
  const width = Math.max(...items.map((i) => i.key.length));
  const paint: Record<RowStatusKind, (s: string) => string> = { ok: green, muted: dim, warn: yellow };
  for (const it of items) {
    const status = it.status ? `  ${paint[it.statusKind ?? 'muted'](it.status)}` : '';
    line(`${green('✓')} ${dim(it.key.padEnd(width))}  ${cyan(it.value)}${status}`);
  }
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export interface Spinner {
  start: (message?: string) => void;
  message: (message: string) => void;
  stop: (message?: string, code?: number) => void;
  /** Halt and erase the spinner line WITHOUT printing a final status line. */
  clear: () => void;
}

/**
 * The currently-running spinner, if any. A prompt pauses it before opening so
 * the 80ms redraw interval can't overwrite the question (see withPrompt).
 * Internal — not part of the public Spinner surface.
 */
interface PausableSpinner {
  pause: () => void;
  resume: () => void;
}
let activeSpinner: PausableSpinner | null = null;

/**
 * spinner: start(msg) / message(msg) / stop(msg, code).
 *
 * With a UI host, the spinner reports its message through `host.status()` and
 * never animates; `stop()` still records its final line.
 */
function spinner(): Spinner {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let text = '';
  let hosted = false;
  const isTty = Boolean(process.stdout.isTTY);
  const render = () => {
    process.stdout.write(`\r${INDENT}${dim(SPINNER_FRAMES[(frame = (frame + 1) % SPINNER_FRAMES.length)])} ${text}`);
  };
  const clearLine = () => {
    if (isTty) process.stdout.write('\r\x1b[2K');
  };
  const tick = () => {
    if (isTty && !timer) {
      render();
      timer = setInterval(render, 80);
    }
  };
  const handle: Spinner & PausableSpinner = {
    start(message = '') {
      text = message;
      if (uiHost) {
        hosted = true;
        uiHost.status(text);
        return;
      }
      if (isTty) {
        tick();
        activeSpinner = handle;
      } else {
        line(`${dim('…')} ${text}`);
      }
    },
    message(message: string) {
      text = message;
      if (hosted) uiHost?.status(text);
    },
    stop(message?: string, code = 0) {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (activeSpinner === handle) activeSpinner = null;
      if (hosted) {
        hosted = false;
        uiHost?.status(null);
      } else {
        clearLine();
      }
      const final = message ?? text;
      emit(code === 0 ? 'success' : 'error', final, `${code === 0 ? green('✓') : red('✗')} ${final}`);
    },
    // Halt + erase without printing a final line (e.g. an orphaned spinner from
    // a failed step being cleared before a prompt), and deregister so a prompt
    // doesn't resume it.
    clear() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      if (activeSpinner === handle) activeSpinner = null;
      if (hosted) {
        hosted = false;
        uiHost?.status(null);
        return;
      }
      clearLine();
    },
    // Pause/resume let a prompt borrow the terminal: pause clears the spinner
    // line and halts the redraw interval; resume restarts it. stop() is NOT
    // called, so activeSpinner stays registered across the prompt.
    pause() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
      clearLine();
    },
    resume() {
      // Only resume if this handle is still the active spinner — never resurrect
      // a spinner that was stopped or cleared while the prompt was open.
      if (activeSpinner === handle) tick();
    },
  };
  return handle;
}

// ── Cancellation ──────────────────────────────────────────────────────────────

/**
 * Returned by a prompt when the user cancels (ctrl-c) or a signal aborts it.
 * Typed as a plain `symbol` (not `unique symbol`) to preserve the exact
 * generic-inference behavior at call sites like `assertNotCancelled<T>(v: T | symbol)`.
 */
export const CANCEL: symbol = Symbol('workos.prompt.cancel');

/** Type guard that narrows a prompt result to a non-cancel value. */
export function isCancel(value: unknown): value is symbol {
  return value === CANCEL;
}

/** Print a cancellation line. */
export function cancel(message = 'Cancelled'): void {
  if (uiHost) {
    uiHost.line({ kind: 'plain', message, rendered: dim(message), stream: 'stderr' });
    return;
  }
  console.error(INDENT + dim(message));
}

const CANCEL_ERROR_NAMES = new Set(['ExitPromptError', 'AbortPromptError', 'CancelPromptError']);
function isCancelError(error: unknown): boolean {
  return error instanceof Error && CANCEL_ERROR_NAMES.has(error.name);
}

// ── Prompt coordination ───────────────────────────────────────────────────────

/**
 * Thrown when a prompt is attempted where the user cannot answer: machine
 * (`--json`) output, or a non-interactive stdin (piped / no TTY). Previously
 * these either corrupted machine output or hung forever waiting on a stdin that
 * never delivers a keystroke. Callers that reach this generally have an upstream
 * gap (they should have gated on isPromptAllowed()/isJsonMode() and offered a
 * flag) — surfacing it fails fast with a clear next step instead of hanging.
 */
export class PromptUnavailableError extends Error {
  constructor(
    public readonly reason: 'json' | 'no-tty',
    message: string,
  ) {
    super(message);
    this.name = 'PromptUnavailableError';
  }
}

/**
 * Serializes every prompt through a single-flight chain so two @inquirer prompts
 * can never share stdin at once. The installer's XState `preparing` state runs
 * git-dirty and protected-branch checks in PARALLEL regions, each of which can
 * open a prompt from a fire-and-forget event handler — without this, both prompts
 * render on the same stdin and steal each other's keystrokes ("it asked a
 * question but wasn't there to answer it"). It also pauses any live spinner so
 * the 80ms redraw interval can't overwrite the question.
 */
let promptChain: Promise<unknown> = Promise.resolve();

/** Hand a prompt to the UI host, short-circuiting one whose signal already aborted. */
async function hostPrompt<T>(host: UiHost, request: UiPromptRequest): Promise<T | symbol> {
  if (request.signal?.aborted) return CANCEL;
  return (await host.prompt(request)) as T | symbol;
}

async function withPrompt<T>(run: () => Promise<T>): Promise<T> {
  if (isJsonMode()) {
    throw new PromptUnavailableError(
      'json',
      'Cannot prompt for input in --json mode. Re-run without --json, or pass the flag that answers it (e.g. --yes / --force).',
    );
  }
  if (!process.stdin.isTTY) {
    throw new PromptUnavailableError(
      'no-tty',
      'This step needs an interactive terminal. Re-run in a terminal, or pass the required flags to run non-interactively.',
    );
  }
  const prior = promptChain.catch(() => undefined);
  let release!: () => void;
  promptChain = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prior;
  const spinner = activeSpinner;
  spinner?.pause();
  try {
    return await run();
  } finally {
    spinner?.resume();
    release();
  }
}

/**
 * Adapt the validate contract (return error string / Error when invalid,
 * undefined when valid) to @inquirer's (return true when valid, string when not).
 */
export type ValidateFn = (
  value: string,
) => string | Error | undefined | void | Promise<string | Error | undefined | void>;
function adaptValidate(validate?: ValidateFn) {
  if (!validate) return undefined;
  return async (value: string): Promise<boolean | string> => {
    const result = await validate(value);
    if (result == null) return true;
    return result instanceof Error ? result.message : String(result);
  };
}

// ── Input surface (@inquirer under the hood) ─────────────────────

export interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
  signal?: AbortSignal;
}
async function confirm(options: ConfirmOptions): Promise<boolean | symbol> {
  const context = takePromptContext();
  return withPrompt(async () => {
    if (uiHost) return hostPrompt<boolean>(uiHost, { kind: 'confirm', ...options, ...context });
    const { confirm: inquirerConfirm } = await import('@inquirer/prompts');
    try {
      return await inquirerConfirm(
        { message: options.message, default: options.initialValue },
        { signal: options.signal },
      );
    } catch (error) {
      if (isCancelError(error)) return CANCEL;
      throw error;
    }
  });
}

export interface SelectOption<T> {
  value: T;
  label?: string;
  hint?: string;
  /** Not selectable; a string renders as the reason next to the row. */
  disabled?: boolean | string;
}
export interface SelectOptions<T> {
  message: string;
  options: ReadonlyArray<SelectOption<T>>;
  initialValue?: T;
  maxItems?: number;
  signal?: AbortSignal;
}
async function select<T>(options: SelectOptions<T>): Promise<T | symbol> {
  const context = takePromptContext();
  return withPrompt(async () => {
    if (uiHost) return hostPrompt<T>(uiHost, { kind: 'select', ...(options as SelectOptions<unknown>), ...context });
    const { select: inquirerSelect } = await import('@inquirer/prompts');
    try {
      return await inquirerSelect<T>(
        {
          message: options.message,
          choices: options.options.map((o) => ({
            value: o.value,
            name: o.label ?? String(o.value),
            description: o.hint,
            disabled: o.disabled,
          })),
          default: options.initialValue,
          pageSize: options.maxItems,
        },
        { signal: options.signal },
      );
    } catch (error) {
      if (isCancelError(error)) return CANCEL;
      throw error;
    }
  });
}

export interface TextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: ValidateFn;
  signal?: AbortSignal;
}
async function text(options: TextOptions): Promise<string | symbol> {
  const context = takePromptContext();
  return withPrompt(async () => {
    if (uiHost) return hostPrompt<string>(uiHost, { kind: 'text', ...options, ...context });
    // @inquirer/input has no placeholder concept, and mapping it to `default`
    // would auto-submit the hint as the real value on an empty enter. Fold it
    // into the message so the hint survives (rendered as ghost text previously).
    const message = options.placeholder ? `${options.message} (${options.placeholder})` : options.message;
    const { input: inquirerInput } = await import('@inquirer/prompts');
    try {
      return await inquirerInput(
        {
          message,
          default: options.defaultValue ?? options.initialValue,
          validate: adaptValidate(options.validate),
        },
        { signal: options.signal },
      );
    } catch (error) {
      if (isCancelError(error)) return CANCEL;
      throw error;
    }
  });
}

export interface PasswordOptions {
  message: string;
  validate?: ValidateFn;
  signal?: AbortSignal;
}
async function password(options: PasswordOptions): Promise<string | symbol> {
  const context = takePromptContext();
  return withPrompt(async () => {
    if (uiHost) return hostPrompt<string>(uiHost, { kind: 'password', ...options, ...context });
    const { password: inquirerPassword } = await import('@inquirer/prompts');
    try {
      return await inquirerPassword(
        { message: options.message, mask: true, validate: adaptValidate(options.validate) },
        { signal: options.signal },
      );
    } catch (error) {
      if (isCancelError(error)) return CANCEL;
      throw error;
    }
  });
}

// ── Default export (the `ui` facade) ────────────────────────────────────────

const ui = {
  intro,
  outro,
  heading,
  note,
  rows,
  pill,
  log,
  spinner,
  confirm,
  select,
  text,
  password,
  isCancel,
  cancel,
};

export default ui;
