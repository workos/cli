import type { InteractionMode } from '../../utils/interaction-mode.js';
import { MIN_COLUMNS, MIN_ROWS } from '../../tui/theme.js';

export type InstallerAdapterKind = 'headless' | 'cli' | 'tui';

export interface AdapterSelectionInput {
  /** Machine (JSON/NDJSON) output. */
  json: boolean;
  interaction: InteractionMode;
  /** The hidden --ci flag. */
  ci: boolean;
  stdinTTY: boolean;
  stdoutTTY: boolean;
  /** Redirected stderr means someone is capturing errors: keep them on it. */
  stderrTTY: boolean;
  columns: number;
  rows: number;
  /** --no-tui */
  noTui: boolean;
  /** $TERM */
  term?: string;
}

/**
 * Which adapter renders the installer.
 *
 * JSON output is always headless (a prompt can't render into a JSON stream).
 * The full-screen installer is for a person at a real, big-enough terminal;
 * every other human run keeps the plain CLI adapter, as before.
 */
export function selectInstallerAdapter(input: AdapterSelectionInput): InstallerAdapterKind {
  if (input.json) return 'headless';
  if (input.interaction !== 'human' || input.ci) return 'cli';
  if (!input.stdinTTY || !input.stdoutTTY || !input.stderrTTY) return 'cli';
  if (input.noTui) return 'cli';
  if (input.term === 'dumb') return 'cli';
  if (input.columns < MIN_COLUMNS || input.rows < MIN_ROWS) return 'cli';
  return 'tui';
}
