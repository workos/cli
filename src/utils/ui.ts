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
import {
  confirm as inquirerConfirm,
  select as inquirerSelect,
  input as inquirerInput,
  password as inquirerPassword,
} from '@inquirer/prompts';

// ── Dashboard mode ──────────────────────────────────────────────────────────
// When true, suppress all human output (the Dashboard adapter drives its own UI).
let dashboardMode = false;
export function setDashboardMode(enabled: boolean): void {
  dashboardMode = enabled;
}
export function isDashboardMode(): boolean {
  return dashboardMode;
}

// ── Palette (chalk auto-disables color when chalk.level === 0, set by
// setOutputMode in JSON mode) ────────────────────────────────────────────────
const accent = chalk.hex('#6363f1'); // WorkOS indigo
const green = chalk.hex('#34d399');
const red = chalk.hex('#f87171');
const yellow = chalk.hex('#fbbf24');
const cyan = chalk.hex('#7dd3fc'); // values, paths, URLs
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

/** Print one indented line to stdout (suppressed in dashboard mode). */
function line(text = ''): void {
  if (dashboardMode) return;
  console.log(INDENT + text);
}

// ── Output surface ───────────────────────────────────────────────────────────

/**
 * Branded title line, framed by blank lines. With a subtitle it renders
 * `Title · subtitle` (accent-bold name, dim subtitle) — the dad-style header.
 */
function intro(title: string, subtitle?: string): void {
  if (dashboardMode) return;
  console.log('');
  line(subtitle ? `${accent(bold(title))}  ${dim('·')}  ${dim(subtitle)}` : accent(bold(title)));
  console.log('');
}

/** Closing line. */
function outro(message = ''): void {
  if (dashboardMode) return;
  console.log('');
  if (message) line(dim(message));
  console.log('');
}

/** A titled section header — anchors a "moment" that owns several lines. */
function heading(title: string): void {
  if (dashboardMode) return;
  console.log('');
  line(accent(bold(title)));
}

/** Multi-line indented note. Body dim; optional bold title. */
function note(message: string, title?: string): void {
  if (dashboardMode) return;
  console.log('');
  if (title) line(bold(title));
  for (const l of String(message).split('\n')) line(dim(l));
  console.log('');
}

const log = {
  message: (m: string) => line(m),
  info: (m: string) => line(m),
  step: (m: string) => line(`${accent('›')} ${m}`),
  success: (m: string) => line(`${green('✓')} ${m}`),
  warn: (m: string) => line(`${yellow('!')} ${m}`),
  warning: (m: string) => line(`${yellow('!')} ${m}`),
  error: (m: string) => line(`${red('✗')} ${m}`),
  /** A muted, low-priority aside (opt-out hints, "run X later"). One dim line. */
  hint: (m: string) => line(dim(m)),
  /** A nested sub-step, indented one level under its parent line. */
  detail: (m: string) => line(`  ${dim('›')} ${dim(m)}`),
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
  if (dashboardMode || items.length === 0) return;
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
}

/** spinner: start(msg) / message(msg) / stop(msg, code). */
function spinner(): Spinner {
  let timer: ReturnType<typeof setInterval> | undefined;
  let frame = 0;
  let text = '';
  const isTty = Boolean(process.stdout.isTTY) && !dashboardMode;
  const render = () => {
    process.stdout.write(`\r${INDENT}${dim(SPINNER_FRAMES[(frame = (frame + 1) % SPINNER_FRAMES.length)])} ${text}`);
  };
  return {
    start(message = '') {
      text = message;
      if (dashboardMode) return;
      if (isTty) {
        render();
        timer = setInterval(render, 80);
      } else {
        line(`${dim('…')} ${text}`);
      }
    },
    message(message: string) {
      text = message;
    },
    stop(message?: string, code = 0) {
      if (timer) clearInterval(timer);
      if (dashboardMode) return;
      if (isTty) process.stdout.write('\r\x1b[2K');
      const glyph = code === 0 ? green('✓') : red('✗');
      line(`${glyph} ${message ?? text}`);
    },
  };
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
  if (dashboardMode) return;
  console.error(INDENT + dim(message));
}

const CANCEL_ERROR_NAMES = new Set(['ExitPromptError', 'AbortPromptError', 'CancelPromptError']);
function isCancelError(error: unknown): boolean {
  return error instanceof Error && CANCEL_ERROR_NAMES.has(error.name);
}

/**
 * Adapt the validate contract (return error string / Error when invalid,
 * undefined when valid) to @inquirer's (return true when valid, string when not).
 */
type ValidateFn = (value: string) => string | Error | undefined | void | Promise<string | Error | undefined | void>;
function adaptValidate(validate?: ValidateFn) {
  if (!validate) return undefined;
  return async (value: string): Promise<boolean | string> => {
    const result = await validate(value);
    if (result == null) return true;
    return result instanceof Error ? result.message : String(result);
  };
}

// ── Input surface (@inquirer under the hood) ─────────────────────

interface ConfirmOptions {
  message: string;
  initialValue?: boolean;
  signal?: AbortSignal;
}
async function confirm(options: ConfirmOptions): Promise<boolean | symbol> {
  try {
    return await inquirerConfirm({ message: options.message, default: options.initialValue }, { signal: options.signal });
  } catch (error) {
    if (isCancelError(error)) return CANCEL;
    throw error;
  }
}

interface SelectOption<T> {
  value: T;
  label?: string;
  hint?: string;
}
interface SelectOptions<T> {
  message: string;
  options: ReadonlyArray<SelectOption<T>>;
  initialValue?: T;
  maxItems?: number;
  signal?: AbortSignal;
}
async function select<T>(options: SelectOptions<T>): Promise<T | symbol> {
  try {
    return await inquirerSelect<T>(
      {
        message: options.message,
        choices: options.options.map((o) => ({ value: o.value, name: o.label ?? String(o.value), description: o.hint })),
        default: options.initialValue,
        pageSize: options.maxItems,
      },
      { signal: options.signal },
    );
  } catch (error) {
    if (isCancelError(error)) return CANCEL;
    throw error;
  }
}

interface TextOptions {
  message: string;
  placeholder?: string;
  defaultValue?: string;
  initialValue?: string;
  validate?: ValidateFn;
  signal?: AbortSignal;
}
async function text(options: TextOptions): Promise<string | symbol> {
  try {
    // @inquirer/input has no placeholder concept, and mapping it to `default`
    // would auto-submit the hint as the real value on an empty enter. Fold it
    // into the message so the hint survives (rendered as ghost text previously).
    const message = options.placeholder ? `${options.message} (${options.placeholder})` : options.message;
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
}

interface PasswordOptions {
  message: string;
  validate?: ValidateFn;
  signal?: AbortSignal;
}
async function password(options: PasswordOptions): Promise<string | symbol> {
  try {
    return await inquirerPassword({ message: options.message, mask: true, validate: adaptValidate(options.validate) }, { signal: options.signal });
  } catch (error) {
    if (isCancelError(error)) return CANCEL;
    throw error;
  }
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
