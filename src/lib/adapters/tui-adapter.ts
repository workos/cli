/**
 * Full-screen installer adapter.
 *
 * It wraps the CLIAdapter rather than re-implementing it: every installer
 * event is still handled, and every question asked and answered, by the same
 * code as the plain CLI. What changes is where that goes. A UI host
 * (`setUiHost`) receives the lines and prompts instead of the terminal, the
 * run model turns installer events into the task list and walkthrough, and
 * Ink draws it all on the alternate screen.
 *
 * Nothing the plain CLI would have printed is lost: it's collected while the
 * full screen is up and printed to the normal screen when it closes, so the
 * scrollback ends with the same summary a plain run leaves.
 */

import { basename } from 'node:path';
import { format } from 'node:util';
import { createElement } from 'react';
import { render, type Instance } from 'ink';
import chalk from 'chalk';
import type { AdapterConfig, InstallerAdapter } from './types.js';
import type { InstallerEventEmitter } from '../events.js';
import { CLIAdapter } from './cli-adapter.js';
import { CANCEL, isCancel, setUiHost, type UiHost, type UiLine, type UiPromptRequest } from '../../utils/ui.js';
import { createRunModel, type RunModel } from '../../tui/model/run-model.js';
import { loadInstallerContent } from '../../tui/content/index.js';
import { InstallerApp } from '../../tui/App.js';
import { ENTER_FULLSCREEN, LEAVE_FULLSCREEN, releaseStdin, writeNow } from '../../tui/terminal.js';

export interface TuiAdapterConfig extends AdapterConfig {
  /** Project directory, for relative file paths and the header. */
  installDir: string;
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
  tipIntervalMs?: number;
  /** Tests: have Ink write every frame whole (it skips live redraws when $CI is set). */
  renderFrames?: boolean;
}

const INDENT = '  ';
const ANSI = /\x1b\[[0-9;]*m/g;
const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleMethod = (typeof CONSOLE_METHODS)[number];

interface PendingPrompt {
  request: UiPromptRequest;
  resolve: (value: unknown) => void;
  onAbort: () => void;
}

/** How an answered prompt reads in the scrollback, like inquirer leaves it. */
function answeredLine(request: UiPromptRequest, value: unknown): string {
  const message = request.message;
  if (isCancel(value)) return `${INDENT}${chalk.red('✗')} ${message} ${chalk.dim('cancelled')}`;
  let answer: string;
  switch (request.kind) {
    case 'confirm':
      answer = value ? 'Yes' : 'No';
      break;
    case 'select': {
      const option = request.options.find((o) => o.value === value);
      answer = option?.label ?? String(value);
      break;
    }
    case 'password':
      answer = '********';
      break;
    default:
      answer = String(value);
  }
  return `${INDENT}${chalk.green('✔')} ${message} ${chalk.cyan(answer)}`;
}

export class TuiAdapter implements InstallerAdapter {
  readonly emitter: InstallerEventEmitter;
  private readonly cli: CLIAdapter;
  private readonly config: TuiAdapterConfig;
  private readonly stdout: NodeJS.WriteStream;
  private readonly stdin: NodeJS.ReadStream;
  private model: RunModel | null = null;
  private ink: Instance | null = null;
  private pending: PendingPrompt | null = null;
  private transcript: string[] = [];
  private savedConsole: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};
  private active = false;

  constructor(config: TuiAdapterConfig) {
    this.config = config;
    this.emitter = config.emitter;
    this.cli = new CLIAdapter(config);
    this.stdout = config.stdout ?? process.stdout;
    this.stdin = config.stdin ?? process.stdin;
  }

  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      this.model = createRunModel({
        emitter: this.emitter,
        content: loadInstallerContent(),
        cwd: this.config.installDir,
      });
      this.captureConsole();
      setUiHost(this.host);
      // Covers every way out that skips stop(): process.exit() from a handler,
      // the plain CLI's SIGINT handler, an uncaught error.
      process.on('exit', this.teardown);

      writeNow(this.stdout, ENTER_FULLSCREEN);
      this.ink = render(
        createElement(InstallerApp, {
          model: this.model,
          answer: this.answer,
          // ctrl-c with no prompt open: the same SIGINT path as the plain CLI.
          interrupt: () => process.emit('SIGINT'),
          projectName: basename(this.config.installDir),
          tipIntervalMs: this.config.tipIntervalMs,
        }),
        {
          stdout: this.stdout,
          stdin: this.stdin,
          exitOnCtrlC: false,
          patchConsole: false,
          debug: this.config.renderFrames ?? false,
        },
      );

      // Last, so its brand mark and handlers land inside the full screen.
      await this.cli.start();
    } catch (error) {
      // Don't leave the terminal, console, or ui hijacked by a half-started view.
      await this.cli.stop();
      this.teardown();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    await this.cli.stop();
    this.teardown();
  }

  /** Restore the terminal and print the transcript. Safe to call more than once. */
  private teardown = (): void => {
    if (!this.active) return;
    this.active = false;
    process.off('exit', this.teardown);

    // A prompt nobody will answer now must not leave its caller hanging.
    this.settle(CANCEL);
    try {
      this.ink?.unmount();
    } catch {
      // Already gone.
    }
    this.ink = null;
    releaseStdin(this.stdin);
    writeNow(this.stdout, LEAVE_FULLSCREEN);

    setUiHost(null);
    this.restoreConsole();
    this.model?.dispose();
    this.model = null;

    const transcript = this.transcript.splice(0);
    if (transcript.length) writeNow(this.stdout, `${transcript.join('\n')}\n`);
  };

  // ── UI host ─────────────────────────────────────────────────────────────

  private readonly host: UiHost = {
    line: (line: UiLine) => {
      this.transcript.push(line.rendered ? INDENT + line.rendered : '');
      // Warnings and errors also show in the walkthrough. A line ending in ':'
      // only introduces a list that follows, so it would read as broken there.
      const message = line.message.replace(ANSI, '').trim();
      if ((line.kind === 'warn' || line.kind === 'error') && message && !message.endsWith(':')) {
        this.model?.addNotice(line.kind === 'warn' ? 'warning' : 'error', message);
      }
    },
    status: (message) => this.model?.setStatus(message ? message.replace(ANSI, '') : null),
    prompt: (request) =>
      new Promise((resolve) => {
        const onAbort = () => this.settle(CANCEL);
        request.signal?.addEventListener('abort', onAbort, { once: true });
        this.pending = { request, resolve, onAbort };
        this.model?.setPrompt(request);
      }),
  };

  private readonly answer = (value: unknown): void => this.settle(value);

  private settle(value: unknown): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.request.signal?.removeEventListener('abort', pending.onAbort);
    this.model?.setPrompt(null);
    this.transcript.push(answeredLine(pending.request, value));
    pending.resolve(value);
  }

  // ── Console capture ─────────────────────────────────────────────────────
  // Direct console output (the brand mark, the device-code URL, the completion
  // summary, debug lines) would scribble over the full screen, so it joins the
  // transcript instead.

  private captureConsole(): void {
    for (const method of CONSOLE_METHODS) {
      this.savedConsole[method] = console[method];
      console[method] = (...args: unknown[]) => {
        this.transcript.push(format(...args));
      };
    }
  }

  private restoreConsole(): void {
    for (const method of CONSOLE_METHODS) {
      const original = this.savedConsole[method];
      if (original) console[method] = original;
    }
    this.savedConsole = {};
  }
}
